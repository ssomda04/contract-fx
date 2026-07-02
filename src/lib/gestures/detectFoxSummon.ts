import type { GesturePhase, GestureState, HandLandmarks, Point2D } from "./types";
import {
  averagePairwiseDistance,
  clamp01,
  distance2D,
  smoothScore,
} from "./geometry";

export const FOX_SUMMON_GESTURE_NAME = "fox-summon";

/**
 * "Fox summon hand sign" (anime-inspired, not tied to any specific
 * work/character): index and pinky extended like fox ears, while thumb,
 * middle, and ring fingertips curl together into a loop/mouth shape.
 */
const LANDMARK_INDEX = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_TIP: 20,
} as const;

/** Floor for the normalizing hand-scale distance, avoids divide-by-near-zero on degenerate landmark frames. */
const MIN_HAND_SCALE = 0.01;

/** A finger counts as "extended" once tip-from-wrist clears pip-from-wrist by this much of the hand scale. */
const EXTENSION_PIP_MARGIN = 0.15;
/** ...and clears mcp-from-wrist (scaled by this ratio) by this much of the hand scale. */
const EXTENSION_MCP_RATIO = 1.15;
const EXTENSION_MCP_MARGIN = 0.2;

/** Normalized (by hand scale) distance at/below which thumb/middle/ring tips count as "looped together". */
const MAX_LOOP_NORMALIZED_DISTANCE = 0.35;
/** How much closer (normalized) the thumb must be to the loop than to the index tip, to rule out a rock sign. */
const ANTI_ROCK_SIGN_MARGIN = 0.15;

const CONFIDENCE_THRESHOLD = 0.6;
const POSITION_BOOST = 0.05;
const POSITION_BOOST_Y = 0.7;

const HOLD_THRESHOLD_MS = 500;
const COOLDOWN_MS = 1500;

export interface FoxSummonBookkeeping {
  conditionStartedAt: number | null;
  lastTriggeredAt: number | null;
}

export const INITIAL_FOX_SUMMON_BOOKKEEPING: FoxSummonBookkeeping = {
  conditionStartedAt: null,
  lastTriggeredAt: null,
};

export interface FoxSummonDetectionResult {
  state: GestureState;
  bookkeeping: FoxSummonBookkeeping;
}

interface ShapeEvaluation {
  satisfied: boolean;
  confidence: number;
}

const NOT_SATISFIED: ShapeEvaluation = { satisfied: false, confidence: 0 };

/** 0..1: how "extended" the finger is, using both the pip- and mcp-relative distance-from-wrist margins. */
function extensionScore(
  wrist: Point2D,
  mcp: Point2D,
  pip: Point2D,
  tip: Point2D,
  handScale: number
): number {
  const tipFromWrist = distance2D(wrist, tip);
  const pipFromWrist = distance2D(wrist, pip);
  const mcpFromWrist = distance2D(wrist, mcp);

  const beyondPip = smoothScore(tipFromWrist - pipFromWrist, 0, handScale * EXTENSION_PIP_MARGIN);
  const beyondMcp = smoothScore(
    tipFromWrist - mcpFromWrist * EXTENSION_MCP_RATIO,
    0,
    handScale * EXTENSION_MCP_MARGIN
  );

  return Math.min(beyondPip, beyondMcp);
}

/** 0..1: how close `point` is to `target` relative to the hand scale (1 = touching, 0 = at/beyond `maxNormalizedDistance`). */
function closenessScore(point: Point2D, target: Point2D, handScale: number, maxNormalizedDistance: number): number {
  const normalizedDistance = distance2D(point, target) / handScale;
  return smoothScore(maxNormalizedDistance - normalizedDistance, 0, maxNormalizedDistance * 0.6);
}

function evaluateHandShape(hand: HandLandmarks): ShapeEvaluation {
  const wrist = hand[LANDMARK_INDEX.WRIST];
  const thumbTip = hand[LANDMARK_INDEX.THUMB_TIP];
  const indexMcp = hand[LANDMARK_INDEX.INDEX_MCP];
  const indexPip = hand[LANDMARK_INDEX.INDEX_PIP];
  const indexTip = hand[LANDMARK_INDEX.INDEX_TIP];
  const middleMcp = hand[LANDMARK_INDEX.MIDDLE_MCP];
  const middlePip = hand[LANDMARK_INDEX.MIDDLE_PIP];
  const middleTip = hand[LANDMARK_INDEX.MIDDLE_TIP];
  const ringMcp = hand[LANDMARK_INDEX.RING_MCP];
  const ringPip = hand[LANDMARK_INDEX.RING_PIP];
  const ringTip = hand[LANDMARK_INDEX.RING_TIP];
  const pinkyMcp = hand[LANDMARK_INDEX.PINKY_MCP];
  const pinkyPip = hand[LANDMARK_INDEX.PINKY_PIP];
  const pinkyTip = hand[LANDMARK_INDEX.PINKY_TIP];

  if (
    !wrist || !thumbTip ||
    !indexMcp || !indexPip || !indexTip ||
    !middleMcp || !middlePip || !middleTip ||
    !ringMcp || !ringPip || !ringTip ||
    !pinkyMcp || !pinkyPip || !pinkyTip
  ) {
    return NOT_SATISFIED;
  }

  const handScale = Math.max(distance2D(wrist, middleMcp), MIN_HAND_SCALE);

  // 1) Index and pinky read as extended, fox-ear-like.
  const indexExtendedScore = extensionScore(wrist, indexMcp, indexPip, indexTip, handScale);
  const pinkyExtendedScore = extensionScore(wrist, pinkyMcp, pinkyPip, pinkyTip, handScale);

  // 2) Middle and ring read as folded AND pulled in close to the thumb (part of the loop).
  const middleFoldedScore = Math.min(
    1 - extensionScore(wrist, middleMcp, middlePip, middleTip, handScale),
    closenessScore(thumbTip, middleTip, handScale, MAX_LOOP_NORMALIZED_DISTANCE)
  );
  const ringFoldedScore = Math.min(
    1 - extensionScore(wrist, ringMcp, ringPip, ringTip, handScale),
    closenessScore(thumbTip, ringTip, handScale, MAX_LOOP_NORMALIZED_DISTANCE)
  );

  // 3) Thumb, middle, and ring tips all sit close together, forming the loop/mouth shape.
  const loopNormalizedDistance =
    averagePairwiseDistance([thumbTip, middleTip, ringTip]) / handScale;
  const thumbMiddleRingLoopScore = smoothScore(
    MAX_LOOP_NORMALIZED_DISTANCE - loopNormalizedDistance,
    0,
    MAX_LOOP_NORMALIZED_DISTANCE * 0.6
  );

  // 4) Reject a rock sign: there the thumb sits out near the index side rather
  //    than curled into the middle/ring loop, so require it to be meaningfully
  //    closer to the loop than to the index fingertip.
  const distThumbToIndex = distance2D(thumbTip, indexTip) / handScale;
  const antiRockSignScore = smoothScore(
    distThumbToIndex - loopNormalizedDistance,
    0,
    ANTI_ROCK_SIGN_MARGIN
  );

  const scores = [
    indexExtendedScore,
    pinkyExtendedScore,
    middleFoldedScore,
    ringFoldedScore,
    thumbMiddleRingLoopScore,
    antiRockSignScore,
  ];
  const geometricMeanConfidence = Math.pow(
    scores.reduce((product, score) => product * score, 1),
    1 / scores.length
  );

  const positionBoostEligible = indexTip.y < POSITION_BOOST_Y || pinkyTip.y < POSITION_BOOST_Y;
  const confidence = clamp01(
    geometricMeanConfidence + (positionBoostEligible ? POSITION_BOOST : 0)
  );

  return {
    satisfied: confidence >= CONFIDENCE_THRESHOLD,
    confidence,
  };
}

function pickBestHand(hands: HandLandmarks[]): ShapeEvaluation {
  let best = NOT_SATISFIED;
  for (const hand of hands) {
    const evaluation = evaluateHandShape(hand);
    if (evaluation.confidence > best.confidence) {
      best = evaluation;
    }
  }
  return best;
}

/**
 * Pure rule-based detector for the fox summon hand sign. Framework-free —
 * callers own the previous-frame bookkeeping and re-supply it each call.
 */
export function detectFoxSummon(
  hands: HandLandmarks[],
  timestampMs: number,
  previous: FoxSummonBookkeeping
): FoxSummonDetectionResult {
  const inCooldown =
    previous.lastTriggeredAt !== null &&
    timestampMs - previous.lastTriggeredAt < COOLDOWN_MS;

  if (inCooldown) {
    return {
      state: {
        currentGestureName: FOX_SUMMON_GESTURE_NAME,
        confidence: 0,
        phase: "cooldown",
        holdDurationMs: 0,
        lastTriggeredAt: previous.lastTriggeredAt,
      },
      bookkeeping: { conditionStartedAt: null, lastTriggeredAt: previous.lastTriggeredAt },
    };
  }

  const { satisfied, confidence } = pickBestHand(hands);

  if (!satisfied) {
    const phase: GesturePhase = hands.length > 0 ? "detecting" : "idle";
    return {
      state: {
        currentGestureName: phase === "idle" ? null : FOX_SUMMON_GESTURE_NAME,
        confidence,
        phase,
        holdDurationMs: 0,
        lastTriggeredAt: previous.lastTriggeredAt,
      },
      bookkeeping: { conditionStartedAt: null, lastTriggeredAt: previous.lastTriggeredAt },
    };
  }

  const conditionStartedAt = previous.conditionStartedAt ?? timestampMs;
  const holdDurationMs = timestampMs - conditionStartedAt;

  if (holdDurationMs >= HOLD_THRESHOLD_MS) {
    return {
      state: {
        currentGestureName: FOX_SUMMON_GESTURE_NAME,
        confidence,
        phase: "triggered",
        holdDurationMs,
        lastTriggeredAt: timestampMs,
      },
      bookkeeping: { conditionStartedAt, lastTriggeredAt: timestampMs },
    };
  }

  return {
    state: {
      currentGestureName: FOX_SUMMON_GESTURE_NAME,
      confidence,
      phase: "holding",
      holdDurationMs,
      lastTriggeredAt: previous.lastTriggeredAt,
    },
    bookkeeping: { conditionStartedAt, lastTriggeredAt: previous.lastTriggeredAt },
  };
}
