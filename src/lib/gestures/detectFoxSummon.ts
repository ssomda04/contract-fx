import type { GesturePhase, GestureState, HandLandmarks } from "./types";
import { distance2D } from "./geometry";

export const FOX_SUMMON_GESTURE_NAME = "fox-summon";

const LANDMARK_INDEX = {
  WRIST: 0,
  INDEX_TIP: 8,
  MIDDLE_TIP: 12,
} as const;

/** Index/middle fingertip gap, normalized by wrist-to-tip distance, below which the shape counts as "pinched". */
const MAX_NORMALIZED_TIP_GAP = 0.35;
/** Floor for the normalizing hand-scale distance, avoids divide-by-near-zero on degenerate landmark frames. */
const MIN_HAND_SCALE = 0.01;
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

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function evaluateHandShape(hand: HandLandmarks): ShapeEvaluation {
  const wrist = hand[LANDMARK_INDEX.WRIST];
  const indexTip = hand[LANDMARK_INDEX.INDEX_TIP];
  const middleTip = hand[LANDMARK_INDEX.MIDDLE_TIP];
  if (!wrist || !indexTip || !middleTip) {
    return NOT_SATISFIED;
  }

  const bothTipsAboveWrist = indexTip.y < wrist.y && middleTip.y < wrist.y;
  if (!bothTipsAboveWrist) {
    return NOT_SATISFIED;
  }

  const handScale = Math.max(
    distance2D(wrist, indexTip),
    distance2D(wrist, middleTip),
    MIN_HAND_SCALE
  );
  const normalizedTipGap = distance2D(indexTip, middleTip) / handScale;

  return {
    satisfied: normalizedTipGap < MAX_NORMALIZED_TIP_GAP,
    confidence: clamp01(1 - normalizedTipGap / MAX_NORMALIZED_TIP_GAP),
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
 * Pure rule-based detector for the "fox summon" gesture: index and middle
 * fingertips held above the wrist and pinched close together. Framework-free
 * — callers own the previous-frame bookkeeping and re-supply it each call.
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
