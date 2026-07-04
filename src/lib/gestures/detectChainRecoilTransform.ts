import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { GesturePhase, GestureState, HandLandmarks, Point2D } from "./types";
import { HAND_LANDMARK } from "./types";
import { centroid, clamp01, closenessScore, distance2D, smoothScore } from "./geometry";
import { estimateChestAnchor, estimateShoulderWidth } from "./bodyAnchors";
import { calculateDisplacement, calculateVelocity } from "./motionSequence";

export const CHAIN_RECOIL_GESTURE_NAME = "chain-recoil-transform";

const MIN_HAND_SCALE = 0.01;
const COOLDOWN_MS = 1500;

// Grip/fist-like scoring (no PIP landmarks available here, unlike the
// extension check other detectors use — this only has each finger's own MCP
// and TIP). A folded finger's tip sits close to both its own MCP (curled
// back) and the hand center (all MCPs cluster near it already), so both are
// required — an open, spread finger fails at least one.
const FINGER_TIP_MCP_MAX_NORMALIZED_DIST = 0.5;
const FINGER_TIP_CENTER_MAX_NORMALIZED_DIST = 0.55;
// "3 of 4" folded, not all 4 — a loose grip/fist, not a perfect one. Taking
// the 3rd-highest of the four per-finger folded scores means it's still low
// unless at least three fingers are genuinely folded, and it naturally reads
// near-zero for an open palm (all four scores low) without a separate
// anti-open-palm check.
const REQUIRED_FOLDED_FINGER_COUNT = 3;

// Stage 1 (precondition): grip held near the chest.
const NEAR_CHEST_MAX_NORMALIZED_DISTANCE = 0.45;
const ARM_CONDITION_THRESHOLD = 0.6;
const GRIP_NEAR_CHEST_HOLD_MS = 200;

// Stage 2 (armed/pulling): once armed, the grip only needs to stay loosely
// closed — same two-stage tracking strategy as pin pull (see
// detectPinPullTransform.ts's trackClosestPinch comment): pick by shape
// score before arming, then follow whichever hand stays closest to the last
// known point once armed, since the near-chest score naturally drops as the
// grip pulls away and MediaPipe has no persistent hand identity to track by.
const ARMED_GRIP_MIN_SCORE = 0.3;
const PULL_MIN_ELAPSED_MS = 150;
const PULL_MAX_ELAPSED_MS = 900;
const PULL_MIN_DISPLACEMENT_RATIO = 0.25; // * shoulderWidth
const PULLING_DISPLAY_DISPLACEMENT_RATIO = 0.1;

// Velocity is a confidence *boost* only (never required), same reasoning and
// same shoulderWidth-relative thresholds as pin pull.
const VELOCITY_BOOST_MIN_RATIO = 0.5; // shoulderWidth/sec
const VELOCITY_BOOST_RANGE_RATIO = 1.5; // shoulderWidth/sec span to reach full boost
const VELOCITY_BOOST_MAX = 0.2;

export interface ChainRecoilBookkeeping {
  /** When the grip-near-chest precondition first became continuously satisfied (resets whenever it isn't). */
  armPreconditionStartedAt: number | null;
  /** When the precondition's hold time crossed GRIP_NEAR_CHEST_HOLD_MS and armed began. */
  armedAt: number | null;
  armedStartHandCenter: Point2D | null;
  lastTriggeredAt: number | null;
}

export const INITIAL_CHAIN_RECOIL_BOOKKEEPING: ChainRecoilBookkeeping = {
  armPreconditionStartedAt: null,
  armedAt: null,
  armedStartHandCenter: null,
  lastTriggeredAt: null,
};

export interface ChainRecoilDetectionResult {
  state: GestureState;
  bookkeeping: ChainRecoilBookkeeping;
}

interface ChainRecoilCandidate {
  handCenter: Point2D;
  gripScore: number;
  armCandidateScore: number;
  debug: Record<string, number>;
}

interface TrackedHand {
  handCenter: Point2D;
  gripScore: number;
}

interface HandBasics {
  handCenter: Point2D;
  handScale: number;
  indexMcp: Point2D;
  indexTip: Point2D;
  middleMcp: Point2D;
  middleTip: Point2D;
  ringMcp: Point2D;
  ringTip: Point2D;
  pinkyMcp: Point2D;
  pinkyTip: Point2D;
}

function readHandBasics(hand: HandLandmarks): HandBasics | null {
  const wrist = hand[HAND_LANDMARK.WRIST];
  const indexMcp = hand[HAND_LANDMARK.INDEX_MCP];
  const middleMcp = hand[HAND_LANDMARK.MIDDLE_MCP];
  const ringMcp = hand[HAND_LANDMARK.RING_MCP];
  const pinkyMcp = hand[HAND_LANDMARK.PINKY_MCP];
  const indexTip = hand[HAND_LANDMARK.INDEX_TIP];
  const middleTip = hand[HAND_LANDMARK.MIDDLE_TIP];
  const ringTip = hand[HAND_LANDMARK.RING_TIP];
  const pinkyTip = hand[HAND_LANDMARK.PINKY_TIP];

  if (
    !wrist || !indexMcp || !middleMcp || !ringMcp || !pinkyMcp ||
    !indexTip || !middleTip || !ringTip || !pinkyTip
  ) {
    return null;
  }

  return {
    handCenter: centroid([wrist, indexMcp, middleMcp, ringMcp, pinkyMcp]),
    handScale: Math.max(distance2D(wrist, middleMcp), MIN_HAND_SCALE),
    indexMcp,
    indexTip,
    middleMcp,
    middleTip,
    ringMcp,
    ringTip,
    pinkyMcp,
    pinkyTip,
  };
}

function fingerFoldedScore(mcp: Point2D, tip: Point2D, handCenter: Point2D, handScale: number): number {
  // Either signal is enough evidence of folding on its own — a curled
  // fingertip returns close to its *own* knuckle (this is the primary,
  // reliable signal), while "close to the hand center" is a looser backup
  // that also fires for a genuinely folded finger whose own MCP happens to
  // sit a bit farther from the centroid (e.g. index/pinky, at the edges of
  // the knuckle row). Requiring both (AND) turned out to reject real folded
  // fingers whose knuckle isn't itself near the centroid.
  const tipNearMcp = closenessScore(tip, mcp, handScale, FINGER_TIP_MCP_MAX_NORMALIZED_DIST);
  const tipNearHandCenter = closenessScore(tip, handCenter, handScale, FINGER_TIP_CENTER_MAX_NORMALIZED_DIST);
  return Math.max(tipNearMcp, tipNearHandCenter);
}

/** The k-th highest score in the list, e.g. k=3 of 4 reads as "at least 3 are this high or higher". */
function kthLargest(scores: number[], k: number): number {
  return [...scores].sort((a, b) => b - a)[k - 1];
}

function gripFoldedScore(basics: HandBasics): number {
  const { handCenter, handScale } = basics;
  const foldedScores = [
    fingerFoldedScore(basics.indexMcp, basics.indexTip, handCenter, handScale),
    fingerFoldedScore(basics.middleMcp, basics.middleTip, handCenter, handScale),
    fingerFoldedScore(basics.ringMcp, basics.ringTip, handCenter, handScale),
    fingerFoldedScore(basics.pinkyMcp, basics.pinkyTip, handCenter, handScale),
  ];
  return kthLargest(foldedScores, REQUIRED_FOLDED_FINGER_COUNT);
}

/**
 * Stage-1 scoring: how well a hand reads as "gripping near the chest" right
 * now. Picks whichever detected hand scores highest, same "best of all
 * hands" approach as the other detectors.
 */
function pickBestGripNearChest(
  hands: HandLandmarks[],
  chestAnchor: Point2D,
  shoulderWidth: number
): ChainRecoilCandidate | null {
  let best: ChainRecoilCandidate | null = null;

  for (const hand of hands) {
    const basics = readHandBasics(hand);
    if (!basics) continue;

    const gripScore = gripFoldedScore(basics);
    const nearChestScore = closenessScore(
      basics.handCenter,
      chestAnchor,
      shoulderWidth,
      NEAR_CHEST_MAX_NORMALIZED_DISTANCE
    );
    const armCandidateScore = Math.min(gripScore, nearChestScore);

    if (!best || armCandidateScore > best.armCandidateScore) {
      best = {
        handCenter: basics.handCenter,
        gripScore,
        armCandidateScore,
        debug: {
          gripScore,
          chestNormalizedDistance: distance2D(basics.handCenter, chestAnchor) / shoulderWidth,
          nearChestScore,
          armCandidateScore,
        },
      };
    }
  }

  return best;
}

/**
 * Stage-2 tracking: once armed, follow whichever hand's center stayed
 * closest to where it was last frame instead of re-scoring the grip shape
 * against the chest anchor (which naturally drops as the grip pulls away).
 */
function trackClosestHandCenter(hands: HandLandmarks[], referencePoint: Point2D): TrackedHand | null {
  let best: (TrackedHand & { distanceFromReference: number }) | null = null;

  for (const hand of hands) {
    const basics = readHandBasics(hand);
    if (!basics) continue;

    const distanceFromReference = distance2D(basics.handCenter, referencePoint);
    if (!best || distanceFromReference < best.distanceFromReference) {
      best = {
        handCenter: basics.handCenter,
        gripScore: gripFoldedScore(basics),
        distanceFromReference,
      };
    }
  }

  return best;
}

function resetBookkeeping(previous: ChainRecoilBookkeeping): ChainRecoilBookkeeping {
  return {
    armPreconditionStartedAt: null,
    armedAt: null,
    armedStartHandCenter: null,
    lastTriggeredAt: previous.lastTriggeredAt,
  };
}

function idleState(
  previous: ChainRecoilBookkeeping,
  confidence: number = 0,
  debug?: Record<string, number>
): ChainRecoilDetectionResult {
  return {
    state: {
      currentGestureName: confidence > 0 ? CHAIN_RECOIL_GESTURE_NAME : null,
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
 * Pure rule-based detector for the chain recoil transform gesture: a motion
 * sequence (grip near the chest, held briefly, then pulled sharply), not a
 * static pose — a static fist held near the chest forever never triggers.
 * Same overall shape as detectPinPullTransform.ts, kept as a fully separate
 * detector rather than merged since the anchor (chest vs neck), hand shape
 * (grip vs pinch), and tracked point (handCenter vs pinchPoint) all differ.
 */
export function detectChainRecoilTransform(
  hands: HandLandmarks[],
  poseLandmarks: NormalizedLandmark[] | null,
  timestampMs: number,
  previous: ChainRecoilBookkeeping
): ChainRecoilDetectionResult {
  const inCooldown =
    previous.lastTriggeredAt !== null && timestampMs - previous.lastTriggeredAt < COOLDOWN_MS;

  if (inCooldown) {
    return {
      state: {
        currentGestureName: CHAIN_RECOIL_GESTURE_NAME,
        confidence: 0,
        phase: "cooldown",
        holdDurationMs: 0,
        lastTriggeredAt: previous.lastTriggeredAt,
      },
      bookkeeping: resetBookkeeping(previous),
    };
  }

  const chestAnchor = poseLandmarks ? estimateChestAnchor(poseLandmarks) : null;
  const shoulderWidth = poseLandmarks ? estimateShoulderWidth(poseLandmarks) : null;

  // Hand AND pose are both required every frame, not just at entry — losing
  // either mid-pull drops the attempt back to idle rather than letting a
  // stale anchor keep it armed.
  if (hands.length === 0 || !chestAnchor || shoulderWidth === null) {
    return idleState(previous);
  }

  if (previous.armedAt === null) {
    const candidate = pickBestGripNearChest(hands, chestAnchor, shoulderWidth);

    if (!candidate || candidate.armCandidateScore < ARM_CONDITION_THRESHOLD) {
      return idleState(previous, candidate?.armCandidateScore ?? 0, candidate?.debug);
    }

    const preconditionStartedAt = previous.armPreconditionStartedAt ?? timestampMs;
    const heldMs = timestampMs - preconditionStartedAt;

    if (heldMs < GRIP_NEAR_CHEST_HOLD_MS) {
      return {
        state: {
          currentGestureName: CHAIN_RECOIL_GESTURE_NAME,
          confidence: candidate.armCandidateScore,
          phase: "idle",
          holdDurationMs: heldMs,
          lastTriggeredAt: previous.lastTriggeredAt,
          debug: candidate.debug,
        },
        bookkeeping: {
          armPreconditionStartedAt: preconditionStartedAt,
          armedAt: null,
          armedStartHandCenter: null,
          lastTriggeredAt: previous.lastTriggeredAt,
        },
      };
    }

    return {
      state: {
        currentGestureName: CHAIN_RECOIL_GESTURE_NAME,
        confidence: candidate.armCandidateScore,
        phase: "armed",
        holdDurationMs: 0,
        lastTriggeredAt: previous.lastTriggeredAt,
        debug: candidate.debug,
      },
      bookkeeping: {
        armPreconditionStartedAt: preconditionStartedAt,
        armedAt: timestampMs,
        armedStartHandCenter: candidate.handCenter,
        lastTriggeredAt: previous.lastTriggeredAt,
      },
    };
  }

  // Armed or pulling.
  const armedStartHandCenter = previous.armedStartHandCenter;
  const armedAt = previous.armedAt;
  if (!armedStartHandCenter || armedAt === null) {
    return idleState(previous);
  }

  const elapsedSinceArmedMs = timestampMs - armedAt;
  if (elapsedSinceArmedMs > PULL_MAX_ELAPSED_MS) {
    return idleState(previous);
  }

  const tracked = trackClosestHandCenter(hands, armedStartHandCenter);
  if (!tracked) {
    return idleState(previous);
  }

  if (tracked.gripScore < ARMED_GRIP_MIN_SCORE) {
    // Grip released before completing the pull -> abandon the attempt.
    return idleState(previous);
  }

  const displacement = calculateDisplacement(tracked.handCenter, armedStartHandCenter);
  const displacementRatio = displacement / shoulderWidth;
  const velocity = calculateVelocity(
    { ...armedStartHandCenter, timestampMs: armedAt },
    { ...tracked.handCenter, timestampMs }
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
    gripScore: tracked.gripScore,
    elapsedSinceArmedMs,
  };

  const canTrigger =
    elapsedSinceArmedMs >= PULL_MIN_ELAPSED_MS && displacementRatio >= PULL_MIN_DISPLACEMENT_RATIO;

  if (canTrigger) {
    return {
      state: {
        currentGestureName: CHAIN_RECOIL_GESTURE_NAME,
        confidence: clamp01(tracked.gripScore + velocityBoost),
        phase: "triggered",
        holdDurationMs: elapsedSinceArmedMs,
        lastTriggeredAt: timestampMs,
        debug,
      },
      bookkeeping: {
        armPreconditionStartedAt: null,
        armedAt: null,
        armedStartHandCenter: null,
        lastTriggeredAt: timestampMs,
      },
    };
  }

  const phase: GesturePhase =
    displacementRatio >= PULLING_DISPLAY_DISPLACEMENT_RATIO ? "pulling" : "armed";

  return {
    state: {
      currentGestureName: CHAIN_RECOIL_GESTURE_NAME,
      confidence: clamp01(tracked.gripScore + velocityBoost),
      phase,
      holdDurationMs: elapsedSinceArmedMs,
      lastTriggeredAt: previous.lastTriggeredAt,
      debug,
    },
    bookkeeping: previous,
  };
}
