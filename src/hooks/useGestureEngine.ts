"use client";

import { useState } from "react";
import type { HandLandmarkerResult } from "@mediapipe/tasks-vision";
import type { GestureState } from "@/lib/gestures/types";
import {
  detectFoxSummon,
  INITIAL_FOX_SUMMON_BOOKKEEPING,
  type FoxSummonBookkeeping,
} from "@/lib/gestures/detectFoxSummon";

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
 * Runs the gesture detectors against each new HandLandmarker frame.
 * Recomputes state during render (the React-documented "adjusting state
 * when a prop changes" pattern) instead of a useEffect + setState, since the
 * computation is a pure, synchronous function of (result, timestampMs,
 * previous-frame bookkeeping) — this avoids an extra render lag.
 */
export function useGestureEngine({
  result,
  timestampMs,
}: UseGestureEngineOptions): GestureState {
  const [gestureState, setGestureState] = useState<GestureState>(INITIAL_GESTURE_STATE);
  const [bookkeeping, setBookkeeping] = useState<FoxSummonBookkeeping>(
    INITIAL_FOX_SUMMON_BOOKKEEPING
  );
  const [processedTimestamp, setProcessedTimestamp] = useState<number | null>(null);

  if (timestampMs !== null && timestampMs !== processedTimestamp) {
    const hands = result?.landmarks ?? [];
    const { state, bookkeeping: nextBookkeeping } = detectFoxSummon(
      hands,
      timestampMs,
      bookkeeping
    );

    setGestureState(state);
    setBookkeeping(nextBookkeeping);
    setProcessedTimestamp(timestampMs);

    return state;
  }

  return gestureState;
}
