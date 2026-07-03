import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { GesturePhase, GestureState, HandLandmarks, Point2D } from "./types";
import { HAND_LANDMARK } from "./types";
import { clamp01, closenessScore, distance2D, midpoint, smoothScore } from "./geometry";
import { estimateNeckAnchor, estimateShoulderWidth } from "./bodyAnchors";
import { calculateDisplacement, calculateVelocity } from "./motionSequence";

export const PIN_PULL_GESTURE_NAME = "pin-pull-transform";

const MIN_HAND_SCALE = 0.01;
const COOLDOWN_MS = 1500;

// Stage 1 (precondition): pinch held near the neck. Exported so
// detectFingerGun.ts can require the *opposite* (thumb tip clearly farther
// from the index tip than this) — a real finger gun and a real pinch would
// otherwise both satisfy finger gun's "thumb far from palm/index knuckle"
// checks, since those don't look at thumb-to-index-*tip* distance at all.
export const PINCH_MAX_NORMALIZED_DISTANCE = 0.35;
const NEAR_NECK_MAX_NORMALIZED_DISTANCE = 0.35;
const ARM_CONDITION_THRESHOLD = 0.6;
const PINCH_NEAR_NECK_HOLD_MS = 200;

// Stage 2 (armed/pulling): once armed, the pinch only needs to stay loosely
// closed — the gating signal shifts from "is this a pinch near the neck" to
// "has this same pinch point moved far enough, fast enough".
// Real camera testing found the original 800ms/0.20 pair a bit unforgiving —
// a real "arm, then decide to pull" reaction takes some of that time before
// any displacement even starts, so the window is loosened and the required
// displacement (a small "short pull", not a big sweep) is eased slightly.
const ARMED_PINCH_MIN_SCORE = 0.3;
const PULL_MIN_ELAPSED_MS = 150;
const PULL_MAX_ELAPSED_MS = 1200;
const PULL_MIN_DISPLACEMENT_RATIO = 0.15; // * shoulderWidth
// Below the trigger displacement, still shown as "pulling" once movement
// clearly started, purely so the debug/priority display reflects progress —
// this doesn't gate anything.
const PULLING_DISPLAY_DISPLACEMENT_RATIO = 0.06;

// Velocity is a confidence *boost* only (never required) per the spec — a
// slow-but-sufficient pull still triggers, this just reads more "confident"
// on a fast one. Thresholds are shoulderWidth-relative like the distance
// ones, so they don't depend on how close the person is to the camera.
const VELOCITY_BOOST_MIN_RATIO = 0.5; // shoulderWidth/sec
const VELOCITY_BOOST_RANGE_RATIO = 1.5; // shoulderWidth/sec span to reach full boost
const VELOCITY_BOOST_MAX = 0.2;

export interface PinPullBookkeeping {
  /** When the pinch-near-neck precondition first became continuously satisfied (resets whenever it isn't). */
  armPreconditionStartedAt: number | null;
  /** When the precondition's hold time crossed PINCH_NEAR_NECK_HOLD_MS and armed began. */
  armedAt: number | null;
  armedStartPinchPoint: Point2D | null;
  lastTriggeredAt: number | null;
}

export const INITIAL_PIN_PULL_BOOKKEEPING: PinPullBookkeeping = {
  armPreconditionStartedAt: null,
  armedAt: null,
  armedStartPinchPoint: null,
  lastTriggeredAt: null,
};

export interface PinPullDetectionResult {
  state: GestureState;
  bookkeeping: PinPullBookkeeping;
}

interface PinPullCandidate {
  pinchPoint: Point2D;
  pinchScore: number;
  armCandidateScore: number;
  debug: Record<string, number>;
}

interface TrackedHand {
  pinchPoint: Point2D;
  thumbTip: Point2D;
  indexTip: Point2D;
  handScale: number;
}

function readHandBasics(hand: HandLandmarks): TrackedHand | null {
  const wrist = hand[HAND_LANDMARK.WRIST];
  const middleMcp = hand[HAND_LANDMARK.MIDDLE_MCP];
  const thumbTip = hand[HAND_LANDMARK.THUMB_TIP];
  const indexTip = hand[HAND_LANDMARK.INDEX_TIP];
  if (!wrist || !middleMcp || !thumbTip || !indexTip) return null;

  return {
    pinchPoint: midpoint(thumbTip, indexTip),
    thumbTip,
    indexTip,
    handScale: Math.max(distance2D(wrist, middleMcp), MIN_HAND_SCALE),
  };
}

/**
 * Stage-1 scoring: how well a hand reads as "pinching near the neck" right
 * now. Picks whichever detected hand scores highest, same "best of all
 * hands" approach as detectFoxSummon/detectFingerGun.
 */
function pickBestPinchNearNeck(
  hands: HandLandmarks[],
  neckAnchor: Point2D,
  shoulderWidth: number
): PinPullCandidate | null {
  let best: PinPullCandidate | null = null;

  for (const hand of hands) {
    const basics = readHandBasics(hand);
    if (!basics) continue;

    const pinchScore = closenessScore(
      basics.thumbTip,
      basics.indexTip,
      basics.handScale,
      PINCH_MAX_NORMALIZED_DISTANCE
    );
    const nearNeckScore = closenessScore(
      basics.pinchPoint,
      neckAnchor,
      shoulderWidth,
      NEAR_NECK_MAX_NORMALIZED_DISTANCE
    );
    const armCandidateScore = Math.min(pinchScore, nearNeckScore);

    if (!best || armCandidateScore > best.armCandidateScore) {
      best = {
        pinchPoint: basics.pinchPoint,
        pinchScore,
        armCandidateScore,
        debug: {
          pinchNormalizedDistance: distance2D(basics.thumbTip, basics.indexTip) / basics.handScale,
          pinchScore,
          neckNormalizedDistance: distance2D(basics.pinchPoint, neckAnchor) / shoulderWidth,
          nearNeckScore,
          armCandidateScore,
        },
      };
    }
  }

  return best;
}

/**
 * Stage-2 tracking: once armed, we no longer pick "whichever hand best
 * matches the shape" (the near-neck score naturally drops as the pinch
 * pulls away from the neck) — instead we follow whichever hand's pinch
 * point stayed closest to where it was last frame, since MediaPipe doesn't
 * give us a persistent hand identity across frames.
 */
function trackClosestPinch(hands: HandLandmarks[], referencePoint: Point2D): TrackedHand | null {
  let best: (TrackedHand & { distanceFromReference: number }) | null = null;

  for (const hand of hands) {
    const basics = readHandBasics(hand);
    if (!basics) continue;

    const distanceFromReference = distance2D(basics.pinchPoint, referencePoint);
    if (!best || distanceFromReference < best.distanceFromReference) {
      best = { ...basics, distanceFromReference };
    }
  }

  return best;
}

function resetBookkeeping(previous: PinPullBookkeeping): PinPullBookkeeping {
  return {
    armPreconditionStartedAt: null,
    armedAt: null,
    armedStartPinchPoint: null,
    lastTriggeredAt: previous.lastTriggeredAt,
  };
}

function idleState(
  previous: PinPullBookkeeping,
  confidence: number = 0,
  debug?: Record<string, number>
): PinPullDetectionResult {
  return {
    state: {
      currentGestureName: confidence > 0 ? PIN_PULL_GESTURE_NAME : null,
      confidence,
      phase: "idle",
      holdDurationMs: 0,
      lastTriggeredAt: previous.lastTriggeredAt,
      debug,
    },
    bookkeeping: resetBookkeeping(previous),
  };
}

/**
 * Pure rule-based detector for the pin pull transform gesture: a motion
 * sequence (pinch near the neck, held briefly, then pulled outward), not a
 * static pose — a static pinch held near the neck forever never triggers.
 * Needs both HandLandmarker and PoseLandmarker output for the same frame.
 */
export function detectPinPullTransform(
  hands: HandLandmarks[],
  poseLandmarks: NormalizedLandmark[] | null,
  timestampMs: number,
  previous: PinPullBookkeeping
): PinPullDetectionResult {
  const inCooldown =
    previous.lastTriggeredAt !== null && timestampMs - previous.lastTriggeredAt < COOLDOWN_MS;

  if (inCooldown) {
    return {
      state: {
        currentGestureName: PIN_PULL_GESTURE_NAME,
        confidence: 0,
        phase: "cooldown",
        holdDurationMs: 0,
        lastTriggeredAt: previous.lastTriggeredAt,
      },
      bookkeeping: resetBookkeeping(previous),
    };
  }

  const neckAnchor = poseLandmarks ? estimateNeckAnchor(poseLandmarks) : null;
  const shoulderWidth = poseLandmarks ? estimateShoulderWidth(poseLandmarks) : null;

  // Hand AND pose are both required every frame, not just at entry — losing
  // either mid-pull (person stepped back, hand left frame) drops the attempt
  // back to idle rather than letting a stale anchor keep it armed.
  if (hands.length === 0 || !neckAnchor || shoulderWidth === null) {
    return idleState(previous);
  }

  if (previous.armedAt === null) {
    const candidate = pickBestPinchNearNeck(hands, neckAnchor, shoulderWidth);

    if (!candidate || candidate.armCandidateScore < ARM_CONDITION_THRESHOLD) {
      return idleState(previous, candidate?.armCandidateScore ?? 0, candidate?.debug);
    }

    const preconditionStartedAt = previous.armPreconditionStartedAt ?? timestampMs;
    const heldMs = timestampMs - preconditionStartedAt;

    if (heldMs < PINCH_NEAR_NECK_HOLD_MS) {
      return {
        state: {
          currentGestureName: PIN_PULL_GESTURE_NAME,
          confidence: candidate.armCandidateScore,
          phase: "idle",
          holdDurationMs: heldMs,
          lastTriggeredAt: previous.lastTriggeredAt,
          debug: candidate.debug,
        },
        bookkeeping: {
          armPreconditionStartedAt: preconditionStartedAt,
          armedAt: null,
          armedStartPinchPoint: null,
          lastTriggeredAt: previous.lastTriggeredAt,
        },
      };
    }

    return {
      state: {
        currentGestureName: PIN_PULL_GESTURE_NAME,
        confidence: candidate.armCandidateScore,
        phase: "armed",
        holdDurationMs: 0,
        lastTriggeredAt: previous.lastTriggeredAt,
        debug: candidate.debug,
      },
      bookkeeping: {
        armPreconditionStartedAt: preconditionStartedAt,
        armedAt: timestampMs,
        armedStartPinchPoint: candidate.pinchPoint,
        lastTriggeredAt: previous.lastTriggeredAt,
      },
    };
  }

  // Armed or pulling.
  const armedStartPinchPoint = previous.armedStartPinchPoint;
  const armedAt = previous.armedAt;
  if (!armedStartPinchPoint || armedAt === null) {
    return idleState(previous);
  }

  const elapsedSinceArmedMs = timestampMs - armedAt;
  if (elapsedSinceArmedMs > PULL_MAX_ELAPSED_MS) {
    return idleState(previous);
  }

  const tracked = trackClosestPinch(hands, armedStartPinchPoint);
  if (!tracked) {
    return idleState(previous);
  }

  const pinchScore = closenessScore(
    tracked.thumbTip,
    tracked.indexTip,
    tracked.handScale,
    PINCH_MAX_NORMALIZED_DISTANCE
  );
  if (pinchScore < ARMED_PINCH_MIN_SCORE) {
    // Pinch released before completing the pull -> abandon the attempt.
    return idleState(previous);
  }

  const displacement = calculateDisplacement(tracked.pinchPoint, armedStartPinchPoint);
  const displacementRatio = displacement / shoulderWidth;
  const velocity = calculateVelocity(
    { ...armedStartPinchPoint, timestampMs: armedAt },
    { ...tracked.pinchPoint, timestampMs }
  );
  const velocityBoost =
    smoothScore(
      velocity,
      shoulderWidth * VELOCITY_BOOST_MIN_RATIO,
      shoulderWidth * (VELOCITY_BOOST_MIN_RATIO + VELOCITY_BOOST_RANGE_RATIO)
    ) * VELOCITY_BOOST_MAX;

  const debug = {
    displacementRatio,
    velocity,
    velocityBoost,
    pinchScore,
    elapsedSinceArmedMs,
  };

  const canTrigger =
    elapsedSinceArmedMs >= PULL_MIN_ELAPSED_MS && displacementRatio >= PULL_MIN_DISPLACEMENT_RATIO;

  if (canTrigger) {
    return {
      state: {
        currentGestureName: PIN_PULL_GESTURE_NAME,
        confidence: clamp01(pinchScore + velocityBoost),
        phase: "triggered",
        holdDurationMs: elapsedSinceArmedMs,
        lastTriggeredAt: timestampMs,
        debug,
      },
      bookkeeping: {
        armPreconditionStartedAt: null,
        armedAt: null,
        armedStartPinchPoint: null,
        lastTriggeredAt: timestampMs,
      },
    };
  }

  const phase: GesturePhase =
    displacementRatio >= PULLING_DISPLAY_DISPLACEMENT_RATIO ? "pulling" : "armed";

  return {
    state: {
      currentGestureName: PIN_PULL_GESTURE_NAME,
      confidence: clamp01(pinchScore + velocityBoost),
      phase,
      holdDurationMs: elapsedSinceArmedMs,
      lastTriggeredAt: previous.lastTriggeredAt,
      debug,
    },
    bookkeeping: previous,
  };
}
