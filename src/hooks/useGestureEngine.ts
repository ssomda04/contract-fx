"use client";

import { useState } from "react";
import type { HandLandmarkerResult } from "@mediapipe/tasks-vision";
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

interface UseGestureEngineOptions {
  result: HandLandmarkerResult | null;
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
 * Ranks candidates for display. `holding`/`triggered` (a gesture actively
 * being formed right now) outrank a different gesture's stale `cooldown`,
 * so switching shapes shows immediate progress feedback instead of hiding
 * behind the previous gesture's lockout; `cooldown` still outranks ambient
 * `detecting` noise from an unrelated hand shape. Ties fall back to confidence.
 */
const PHASE_PRIORITY: Record<GesturePhase, number> = {
  triggered: 4,
  holding: 3,
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
 * Runs every static-pose gesture detector against each new HandLandmarker
 * frame. Each detector owns its own bookkeeping (hold timer, cooldown) and
 * runs independently of the others, so switching from one satisfied gesture
 * to another naturally resets hold duration — the previous gesture's shape
 * condition stops being met, which zeroes its own timer, while the new one
 * starts counting from the frame its shape first became satisfied. The
 * currently reported gesture is just whichever detector "wins" selection
 * this frame, recomputed during render like useEffectTrigger.
 */
export function useGestureEngine({
  result,
  timestampMs,
}: UseGestureEngineOptions): GestureState {
  const [gestureState, setGestureState] = useState<GestureState>(INITIAL_GESTURE_STATE);
  const [foxSummonBookkeeping, setFoxSummonBookkeeping] = useState<FoxSummonBookkeeping>(
    INITIAL_FOX_SUMMON_BOOKKEEPING
  );
  const [fingerGunBookkeeping, setFingerGunBookkeeping] = useState<FingerGunBookkeeping>(
    INITIAL_FINGER_GUN_BOOKKEEPING
  );
  const [processedTimestamp, setProcessedTimestamp] = useState<number | null>(null);

  if (timestampMs !== null && timestampMs !== processedTimestamp) {
    const hands = result?.landmarks ?? [];

    const foxSummon = detectFoxSummon(hands, timestampMs, foxSummonBookkeeping);
    const fingerGun = detectFingerGun(hands, timestampMs, fingerGunBookkeeping);
    const selected = selectGestureState([foxSummon.state, fingerGun.state]);

    setFoxSummonBookkeeping(foxSummon.bookkeeping);
    setFingerGunBookkeeping(fingerGun.bookkeeping);
    setGestureState(selected);
    setProcessedTimestamp(timestampMs);

    return selected;
  }

  return gestureState;
}
