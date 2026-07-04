"use client";

import { useState } from "react";
import type { HandLandmarkerResult, PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import type { GesturePhase, GestureState } from "@/lib/gestures/types";
import {
  detectFoxSummon,
  INITIAL_FOX_SUMMON_BOOKKEEPING,
  type FoxSummonBookkeeping,
} from "@/lib/gestures/detectFoxSummon";
import {
  detectFingerGun,
  INITIAL_FINGER_GUN_BOOKKEEPING,
  type FingerGunBookkeeping,
} from "@/lib/gestures/detectFingerGun";
import {
  detectPinPullTransform,
  INITIAL_PIN_PULL_BOOKKEEPING,
  type PinPullBookkeeping,
} from "@/lib/gestures/detectPinPullTransform";
import {
  detectChainRecoilTransform,
  INITIAL_CHAIN_RECOIL_BOOKKEEPING,
  type ChainRecoilBookkeeping,
} from "@/lib/gestures/detectChainRecoilTransform";

interface UseGestureEngineOptions {
  result: HandLandmarkerResult | null;
  poseResult: PoseLandmarkerResult | null;
  timestampMs: number | null;
}

const INITIAL_GESTURE_STATE: GestureState = {
  currentGestureName: null,
  confidence: 0,
  phase: "idle",
  holdDurationMs: 0,
  lastTriggeredAt: null,
};

/**
 * Ranks candidates for display. `triggered` always wins. Any other "active"
 * phase — a static pose `holding`, or a motion sequence `armed`/`pulling` —
 * outranks a different gesture's stale `cooldown`, so switching shapes/
 * motions shows immediate progress feedback instead of hiding behind the
 * previous gesture's lockout; `cooldown` still outranks ambient `detecting`
 * noise from an unrelated hand shape. Ties fall back to confidence.
 */
const PHASE_PRIORITY: Record<GesturePhase, number> = {
  triggered: 5,
  holding: 4,
  armed: 4,
  pulling: 4,
  cooldown: 2,
  detecting: 1,
  idle: 0,
};

function selectGestureState(candidates: GestureState[]): GestureState {
  return candidates.reduce((selected, candidate) => {
    const candidateRank = PHASE_PRIORITY[candidate.phase];
    const selectedRank = PHASE_PRIORITY[selected.phase];
    const candidateWins =
      candidateRank > selectedRank ||
      (candidateRank === selectedRank && candidate.confidence > selected.confidence);
    return candidateWins ? candidate : selected;
  });
}

/**
 * Runs every gesture detector against each new HandLandmarker frame. Each
 * detector owns its own bookkeeping (hold timer, cooldown, or the armed/pull
 * tracking pin pull needs) and runs independently of the others, so
 * switching from one satisfied gesture to another naturally resets progress
 * — the previous gesture's condition stops being met, which zeroes its own
 * state, while the new one starts counting from the frame its own condition
 * first became satisfied. The currently reported gesture is just whichever
 * detector "wins" selection this frame, recomputed during render like
 * useEffectTrigger.
 *
 * fox summon and finger gun are static poses judged from HandLandmarker
 * alone; pin pull and chain recoil are motion sequences judged from
 * HandLandmarker *and* PoseLandmarker together (each needs its own body
 * anchor — neck or chest — from pose to know where its precondition should
 * start). `poseResult` is read fresh each call rather than driving its own
 * recompute pass — pose runs on a slower frame-skipped cadence than hand
 * tracking, so this simply uses whatever pose result is most recently
 * available whenever a new hand frame arrives.
 */
export function useGestureEngine({
  result,
  poseResult,
  timestampMs,
}: UseGestureEngineOptions): GestureState {
  const [gestureState, setGestureState] = useState<GestureState>(INITIAL_GESTURE_STATE);
  const [foxSummonBookkeeping, setFoxSummonBookkeeping] = useState<FoxSummonBookkeeping>(
    INITIAL_FOX_SUMMON_BOOKKEEPING
  );
  const [fingerGunBookkeeping, setFingerGunBookkeeping] = useState<FingerGunBookkeeping>(
    INITIAL_FINGER_GUN_BOOKKEEPING
  );
  const [pinPullBookkeeping, setPinPullBookkeeping] = useState<PinPullBookkeeping>(
    INITIAL_PIN_PULL_BOOKKEEPING
  );
  const [chainRecoilBookkeeping, setChainRecoilBookkeeping] = useState<ChainRecoilBookkeeping>(
    INITIAL_CHAIN_RECOIL_BOOKKEEPING
  );
  const [processedTimestamp, setProcessedTimestamp] = useState<number | null>(null);

  if (timestampMs !== null && timestampMs !== processedTimestamp) {
    const hands = result?.landmarks ?? [];
    const poseLandmarks = poseResult?.landmarks[0] ?? null;

    const foxSummon = detectFoxSummon(hands, timestampMs, foxSummonBookkeeping);
    const fingerGun = detectFingerGun(hands, timestampMs, fingerGunBookkeeping);
    const pinPull = detectPinPullTransform(hands, poseLandmarks, timestampMs, pinPullBookkeeping);
    const chainRecoil = detectChainRecoilTransform(
      hands,
      poseLandmarks,
      timestampMs,
      chainRecoilBookkeeping
    );
    const selected = selectGestureState([
      foxSummon.state,
      fingerGun.state,
      pinPull.state,
      chainRecoil.state,
    ]);

    setFoxSummonBookkeeping(foxSummon.bookkeeping);
    setFingerGunBookkeeping(fingerGun.bookkeeping);
    setPinPullBookkeeping(pinPull.bookkeeping);
    setChainRecoilBookkeeping(chainRecoil.bookkeeping);
    setGestureState(selected);
    setProcessedTimestamp(timestampMs);

    return selected;
  }

  return gestureState;
}
