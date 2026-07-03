import type { GesturePhase, GestureState, HandLandmark, HandLandmarks, Point2D } from "./types";
import { HAND_LANDMARK } from "./types";
import {
  angleBetweenVectors3D,
  averagePairwiseDistance,
  centroid,
  clamp01,
  closenessScore,
  distance2D,
  fingerExtensionScore,
  smoothScore,
  vectorBetween,
  vectorBetween3D,
} from "./geometry";
import { MAX_LOOP_NORMALIZED_DISTANCE } from "./detectFoxSummon";
import { PINCH_MAX_NORMALIZED_DISTANCE as PIN_PULL_PINCH_MAX_NORMALIZED_DISTANCE } from "./detectPinPullTransform";

export const FINGER_GUN_GESTURE_NAME = "finger-gun";

/** Floor for the normalizing hand-scale distance, avoids divide-by-near-zero on degenerate landmark frames. */
const MIN_HAND_SCALE = 0.01;

const HOLD_THRESHOLD_MS = 500;
const COOLDOWN_MS = 1500;
const CONFIDENCE_THRESHOLD = 0.6;

// thumbOpenScore sub-thresholds (normalized by hand scale, angle in radians).
// Loosened from an earlier pass after real-camera testing showed a genuine,
// intentional finger-gun pose scoring thumbOpen=0.318 — these were simply
// calibrated against idealized synthetic coordinates, not real hand proportions.
const THUMB_MIN_PALM_DISTANCE = 0.22;
const THUMB_MIN_INDEX_MCP_DISTANCE = 0.15;
const THUMB_MIN_SEPARATION_ANGLE = Math.PI / 9; // 20deg
const THUMB_SCORE_ANGLE_RANGE = Math.PI / 4.5; // 40deg span to reach score 1
const THUMB_SCORE_DISTANCE_RANGE = 0.2;

/**
 * Fingertip cluster spread (middle/ring/pinky) — kept only as a debug signal
 * now, not a gating condition. Real camera data showed genuine finger-gun
 * poses with all three per-finger folded scores at a clean 1.000 still
 * scoring spreadNormalizedDistance well past any reasonable threshold
 * (different finger lengths curl to different depths, so folded tips don't
 * necessarily cluster near each other even in a proper grip). The per-finger
 * folded scores already reject open palm reliably on their own.
 */
const OPEN_PALM_SPREAD_THRESHOLD = 0.85;

// --- front-view index sub-thresholds (normalized by hand scale) ---
// When the index points at the camera instead of across the image plane,
// its TIP/DIP/PIP joints project close together (foreshortening) instead of
// spreading out along a visible line — that's what side-view's
// fingerExtensionScore (distance-from-wrist based) can't see.
const INDEX_COMPRESSED_MAX_NORMALIZED_DIST = 0.25;
// A folded/fist index is also compressed, so require the tip to still sit
// meaningfully away from the palm/wrist to tell the two apart. Kept fairly
// strict (tighter than a loosen-everything pass) since this is the main
// defense against a fist being read as a front-view finger gun.
const MIN_INDEX_TIP_PALM_DISTANCE = 0.45;
const MIN_INDEX_TIP_WRIST_DISTANCE = 0.65;
const INDEX_NOT_FOLDED_SCORE_RANGE = 0.15;
// z is noisy from MediaPipe, so it only ever nudges the score, never gates
// pass/fail — but weighted more than an initial pass since it's the only
// real 3D signal separating "pointing at camera" from "folded into a fist"
// when both compress similarly in the 2D image.
const FRONT_VIEW_Z_MARGIN = 0.02;
const FRONT_VIEW_Z_BOOST = 0.3;

export interface FingerGunBookkeeping {
  conditionStartedAt: number | null;
  lastTriggeredAt: number | null;
}

export const INITIAL_FINGER_GUN_BOOKKEEPING: FingerGunBookkeeping = {
  conditionStartedAt: null,
  lastTriggeredAt: null,
};

export interface FingerGunDetectionResult {
  state: GestureState;
  bookkeeping: FingerGunBookkeeping;
  /** INDEX_MCP -> INDEX_TIP direction, for later reuse as an effect direction. Null when no hand qualifies. */
  indexDirection: Point2D | null;
}

interface ShapeEvaluation {
  satisfied: boolean;
  confidence: number;
  indexDirection: Point2D | null;
  debug: Record<string, number>;
}

const NOT_SATISFIED: ShapeEvaluation = {
  satisfied: false,
  confidence: 0,
  indexDirection: null,
  debug: {},
};

/**
 * 0..1: thumb held open and away from the hand, like a gun hammer — combines
 * "far from palm center", "far from the index knuckle", and "wide angle from
 * the hand's own forward axis" so a simple pointing pose (thumb tucked
 * alongside the hand) doesn't qualify.
 *
 * The angle sub-check is measured against `handForwardDirection`
 * (WRIST->MIDDLE_MCP) rather than the index finger's own MCP->TIP direction.
 * That index vector collapses toward zero length in front view (the finger
 * foreshortens toward the camera) and can be short/noisy even in side view
 * depending on hand tilt, which previously let a short-but-not-degenerate
 * vector produce a wrong angle and either wrongly block front-view finger
 * gun or (via an earlier "treat as neutral when short" fallback) wrongly let
 * a tucked-thumb pointing pose through. WRIST->MIDDLE_MCP stays a real,
 * non-degenerate direction regardless of how the index finger is posed.
 *
 * Both directions are computed in 3D (including MediaPipe's z depth), not
 * just image-plane x/y. Real camera data showed a front-view-turned finger
 * gun scoring thumbAngleScore=0.298 (34.5 degrees) despite the thumb being
 * genuinely open — turning the hand toward the camera pushes part of the
 * thumb's opening motion along the z axis, so a 2D-only angle foreshortens
 * and reads smaller than the true separation. The 3D angle stays accurate
 * regardless of hand rotation toward/away from the camera.
 */
interface ScoreWithDebug {
  score: number;
  debug: Record<string, number>;
}

function thumbOpenScore(
  thumbTip: HandLandmark,
  thumbIp: HandLandmark,
  indexMcp: Point2D,
  wrist: HandLandmark,
  middleMcp: HandLandmark,
  palmCenter: Point2D,
  handScale: number
): ScoreWithDebug {
  const distFromPalm = distance2D(thumbTip, palmCenter) / handScale;
  const distFromIndexMcp = distance2D(thumbTip, indexMcp) / handScale;
  const thumbDirection = vectorBetween3D(thumbIp, thumbTip);
  const handForwardDirection = vectorBetween3D(wrist, middleMcp);
  const separationAngleDeg =
    (angleBetweenVectors3D(thumbDirection, handForwardDirection) * 180) / Math.PI;

  const angleScore = smoothScore(
    angleBetweenVectors3D(thumbDirection, handForwardDirection),
    THUMB_MIN_SEPARATION_ANGLE,
    THUMB_MIN_SEPARATION_ANGLE + THUMB_SCORE_ANGLE_RANGE
  );

  const farFromPalmScore = smoothScore(
    distFromPalm,
    THUMB_MIN_PALM_DISTANCE,
    THUMB_MIN_PALM_DISTANCE + THUMB_SCORE_DISTANCE_RANGE
  );
  const farFromIndexMcpScore = smoothScore(
    distFromIndexMcp,
    THUMB_MIN_INDEX_MCP_DISTANCE,
    THUMB_MIN_INDEX_MCP_DISTANCE + THUMB_SCORE_DISTANCE_RANGE
  );

  return {
    score: Math.min(farFromPalmScore, farFromIndexMcpScore, angleScore),
    debug: {
      thumbDistFromPalm: distFromPalm,
      thumbFarFromPalmScore: farFromPalmScore,
      thumbDistFromIndexMcp: distFromIndexMcp,
      thumbFarFromIndexMcpScore: farFromIndexMcpScore,
      thumbSeparationAngleDeg: separationAngleDeg,
      thumbAngleScore: angleScore,
    },
  };
}

/**
 * 0..1: index reads as pointing at the camera (front view) rather than
 * across the image plane (side view). Side view's `fingerExtensionScore`
 * measures how far the tip reaches from the wrist in the 2D image — that
 * collapses when the finger is foreshortened toward the lens, so this is a
 * separate signal based on joint compression instead of reach.
 */
function frontViewIndexScore(
  wrist: Point2D,
  indexPip: Point2D,
  indexDip: Point2D,
  indexTip: Point2D,
  indexTipZ: number,
  indexMcpZ: number,
  palmCenter: Point2D,
  handScale: number
): ScoreWithDebug {
  // Compressed: TIP/DIP/PIP project close together instead of spreading
  // along a visible line, as happens when the finger foreshortens toward camera.
  const tipDipCloseness = closenessScore(
    indexTip,
    indexDip,
    handScale,
    INDEX_COMPRESSED_MAX_NORMALIZED_DIST
  );
  const dipPipCloseness = closenessScore(
    indexDip,
    indexPip,
    handScale,
    INDEX_COMPRESSED_MAX_NORMALIZED_DIST
  );
  const indexCompressedScore = Math.min(tipDipCloseness, dipPipCloseness);

  // Not folded: a curled-into-the-fist index is also compressed, so require
  // the tip to still sit meaningfully away from the palm/wrist.
  const distFromPalm = distance2D(indexTip, palmCenter) / handScale;
  const distFromWrist = distance2D(indexTip, wrist) / handScale;
  const indexNotFoldedScore = Math.min(
    smoothScore(
      distFromPalm,
      MIN_INDEX_TIP_PALM_DISTANCE,
      MIN_INDEX_TIP_PALM_DISTANCE + INDEX_NOT_FOLDED_SCORE_RANGE
    ),
    smoothScore(
      distFromWrist,
      MIN_INDEX_TIP_WRIST_DISTANCE,
      MIN_INDEX_TIP_WRIST_DISTANCE + INDEX_NOT_FOLDED_SCORE_RANGE
    )
  );

  const indexForwardLikeScore = Math.min(indexCompressedScore, indexNotFoldedScore);

  // z is noisy — only ever a nudge, never a hard requirement. Crucially, it
  // can only ever *boost* an already-nonzero 2D signal, never manufacture
  // one: real camera data showed a folded-fist index (indexCompressedScore
  // exactly 0, correctly saying "not front-view") still ending up with
  // frontViewScore=0.3 purely from the z condition, which is backwards — z
  // alone isn't reliable enough to claim front-view when the 2D evidence
  // flatly disagrees.
  const zDiff = indexMcpZ - indexTipZ;
  const tipCloserToCameraThanMcp = zDiff > FRONT_VIEW_Z_MARGIN;
  const zBoost = indexForwardLikeScore > 0 && tipCloserToCameraThanMcp ? FRONT_VIEW_Z_BOOST : 0;
  const score = clamp01(indexForwardLikeScore + zBoost);

  return {
    score,
    debug: {
      frontIndexCompressedScore: indexCompressedScore,
      frontIndexDistFromPalm: distFromPalm,
      frontIndexDistFromWrist: distFromWrist,
      frontIndexNotFoldedScore: indexNotFoldedScore,
      frontIndexZDiff: zDiff,
    },
  };
}

function evaluateHandShape(hand: HandLandmarks): ShapeEvaluation {
  const wrist = hand[HAND_LANDMARK.WRIST];
  const thumbIp = hand[HAND_LANDMARK.THUMB_IP];
  const thumbTip = hand[HAND_LANDMARK.THUMB_TIP];
  const indexMcp = hand[HAND_LANDMARK.INDEX_MCP];
  const indexPip = hand[HAND_LANDMARK.INDEX_PIP];
  const indexDip = hand[HAND_LANDMARK.INDEX_DIP];
  const indexTip = hand[HAND_LANDMARK.INDEX_TIP];
  const middleMcp = hand[HAND_LANDMARK.MIDDLE_MCP];
  const middlePip = hand[HAND_LANDMARK.MIDDLE_PIP];
  const middleTip = hand[HAND_LANDMARK.MIDDLE_TIP];
  const ringMcp = hand[HAND_LANDMARK.RING_MCP];
  const ringPip = hand[HAND_LANDMARK.RING_PIP];
  const ringTip = hand[HAND_LANDMARK.RING_TIP];
  const pinkyMcp = hand[HAND_LANDMARK.PINKY_MCP];
  const pinkyPip = hand[HAND_LANDMARK.PINKY_PIP];
  const pinkyTip = hand[HAND_LANDMARK.PINKY_TIP];

  if (
    !wrist || !thumbIp || !thumbTip ||
    !indexMcp || !indexPip || !indexDip || !indexTip ||
    !middleMcp || !middlePip || !middleTip ||
    !ringMcp || !ringPip || !ringTip ||
    !pinkyMcp || !pinkyPip || !pinkyTip
  ) {
    return NOT_SATISFIED;
  }

  const handScale = Math.max(distance2D(wrist, middleMcp), MIN_HAND_SCALE);
  const palmCenter = centroid([wrist, indexMcp, middleMcp, ringMcp, pinkyMcp]);
  const indexDirection = vectorBetween(indexMcp, indexTip);

  // 1) Index reads as pointing outward, in *either* of two ways: extended
  //    across the image plane (side view) or foreshortened toward the
  //    camera (front view). A hand only needs to satisfy one of these — the
  //    max lets whichever view is actually happening win, and since it feeds
  //    into the same downstream geometric-mean confidence either way, this
  //    is equivalent to computing full side/front confidences and taking
  //    their max (the mean is monotonic in this factor with the others held
  //    fixed), just without duplicating the rest of the scoring.
  const sideViewIndexScore = fingerExtensionScore(wrist, indexMcp, indexPip, indexTip, handScale);
  const frontView = frontViewIndexScore(
    wrist,
    indexPip,
    indexDip,
    indexTip,
    indexTip.z,
    indexMcp.z,
    palmCenter,
    handScale
  );
  const indexExtendedScore = Math.max(sideViewIndexScore, frontView.score);

  // 2) Thumb reads as open, away from the hand — the "hammer".
  const thumb = thumbOpenScore(thumbTip, thumbIp, indexMcp, wrist, middleMcp, palmCenter, handScale);

  // 3) Middle/ring/pinky read as folded.
  const middleFoldedScore = 1 - fingerExtensionScore(wrist, middleMcp, middlePip, middleTip, handScale);
  const ringFoldedScore = 1 - fingerExtensionScore(wrist, ringMcp, ringPip, ringTip, handScale);
  const pinkyFoldedScore = 1 - fingerExtensionScore(wrist, pinkyMcp, pinkyPip, pinkyTip, handScale);

  // 4) Reject fox summon: there thumb+middle+ring curl into a tight loop.
  //    Require the loop to be clearly looser than what fox summon accepts.
  const loopNormalizedDistance = averagePairwiseDistance([thumbTip, middleTip, ringTip]) / handScale;
  const antiFoxSummonScore = smoothScore(
    loopNormalizedDistance - MAX_LOOP_NORMALIZED_DISTANCE,
    0,
    MAX_LOOP_NORMALIZED_DISTANCE * 0.6
  );

  // 5) Reject open palm: there middle/ring/pinky tips splay apart instead of
  //    clustering near the palm.
  const spreadNormalizedDistance = averagePairwiseDistance([middleTip, ringTip, pinkyTip]) / handScale;
  const antiOpenPalmScore = smoothScore(
    OPEN_PALM_SPREAD_THRESHOLD - spreadNormalizedDistance,
    0,
    OPEN_PALM_SPREAD_THRESHOLD * 0.6
  );

  // 6) Reject pin pull: a thumb-index pinch (picking up a small pin near the
  //    neck) can otherwise pass every check above — the thumb is genuinely
  //    far from the palm/index knuckle if the whole hand is reaching away
  //    from the body, and the other fingers often curl in naturally during a
  //    precision pinch, incidentally satisfying "folded". None of the checks
  //    above look at thumb-to-index-*tip* distance specifically, which is the
  //    one thing a pinch and an open "hammer" thumb never share. Reuses pin
  //    pull's own pinch definition (with a margin) as the anti-condition,
  //    same pattern as antiFoxSummonScore reusing its loop threshold.
  const thumbIndexTipNormalizedDistance = distance2D(thumbTip, indexTip) / handScale;
  const antiPinPullScore = smoothScore(
    thumbIndexTipNormalizedDistance - PIN_PULL_PINCH_MAX_NORMALIZED_DISTANCE,
    0,
    PIN_PULL_PINCH_MAX_NORMALIZED_DISTANCE * 0.6
  );

  // Combined via min(), not a geometric mean: these are meant as required
  // (AND) conditions. A mean lets several mediocre-but-not-zero scores
  // compound into a deceptively high confidence (observed on real camera
  // data: thumbOpen=0.32 and antiOpenPalm=0.26 still produced confidence
  // 0.70 under a 7th-root geometric mean) — min() requires every condition
  // to actually be satisfied, which is what "index extended AND thumb open
  // AND middle/ring/pinky folded AND not fox-summon AND not open-palm" means.
  const scores = [
    indexExtendedScore,
    thumb.score,
    middleFoldedScore,
    ringFoldedScore,
    pinkyFoldedScore,
    antiFoxSummonScore,
    antiOpenPalmScore,
    antiPinPullScore,
  ];
  const confidence = clamp01(Math.min(...scores));

  return {
    satisfied: confidence >= CONFIDENCE_THRESHOLD,
    confidence,
    indexDirection,
    // Temporary tuning aid, surfaced via GestureState.debug -> DebugPanel.
    debug: {
      handScale,
      sideViewIndexScore,
      frontViewScore: frontView.score,
      ...frontView.debug,
      indexExtendedScore,
      thumbOpen: thumb.score,
      ...thumb.debug,
      middleFoldedScore,
      ringFoldedScore,
      pinkyFoldedScore,
      antiFoxSummonScore,
      antiOpenPalmScore,
      spreadNormalizedDistance,
      thumbIndexTipNormalizedDistance,
      antiPinPullScore,
    },
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
 * Pure rule-based detector for the finger gun hand sign. Framework-free —
 * callers own the previous-frame bookkeeping and re-supply it each call.
 */
export function detectFingerGun(
  hands: HandLandmarks[],
  timestampMs: number,
  previous: FingerGunBookkeeping
): FingerGunDetectionResult {
  const inCooldown =
    previous.lastTriggeredAt !== null &&
    timestampMs - previous.lastTriggeredAt < COOLDOWN_MS;

  if (inCooldown) {
    return {
      state: {
        currentGestureName: FINGER_GUN_GESTURE_NAME,
        confidence: 0,
        phase: "cooldown",
        holdDurationMs: 0,
        lastTriggeredAt: previous.lastTriggeredAt,
      },
      bookkeeping: { conditionStartedAt: null, lastTriggeredAt: previous.lastTriggeredAt },
      indexDirection: null,
    };
  }

  const { satisfied, confidence, indexDirection, debug } = pickBestHand(hands);

  if (!satisfied) {
    const phase: GesturePhase = hands.length > 0 ? "detecting" : "idle";
    return {
      state: {
        currentGestureName: phase === "idle" ? null : FINGER_GUN_GESTURE_NAME,
        confidence,
        phase,
        holdDurationMs: 0,
        lastTriggeredAt: previous.lastTriggeredAt,
        debug,
      },
      bookkeeping: { conditionStartedAt: null, lastTriggeredAt: previous.lastTriggeredAt },
      indexDirection,
    };
  }

  const conditionStartedAt = previous.conditionStartedAt ?? timestampMs;
  const holdDurationMs = timestampMs - conditionStartedAt;

  if (holdDurationMs >= HOLD_THRESHOLD_MS) {
    return {
      state: {
        currentGestureName: FINGER_GUN_GESTURE_NAME,
        confidence,
        phase: "triggered",
        holdDurationMs,
        lastTriggeredAt: timestampMs,
        debug,
      },
      bookkeeping: { conditionStartedAt, lastTriggeredAt: timestampMs },
      indexDirection,
    };
  }

  return {
    state: {
      currentGestureName: FINGER_GUN_GESTURE_NAME,
      confidence,
      phase: "holding",
      holdDurationMs,
      lastTriggeredAt: previous.lastTriggeredAt,
      debug,
    },
    bookkeeping: { conditionStartedAt, lastTriggeredAt: previous.lastTriggeredAt },
    indexDirection,
  };
}
