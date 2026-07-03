"use client";

import { useState } from "react";
import type { GestureState } from "@/lib/gestures/types";
import { FOX_SUMMON_GESTURE_NAME } from "@/lib/gestures/detectFoxSummon";
import { FINGER_GUN_GESTURE_NAME } from "@/lib/gestures/detectFingerGun";
import { PIN_PULL_GESTURE_NAME } from "@/lib/gestures/detectPinPullTransform";
import type { ActiveEffect, EffectName } from "@/lib/effects/types";

const EFFECT_DISPLAY_DURATION_MS = 1500;

const EFFECT_BY_GESTURE_NAME: Record<string, EffectName> = {
  [FOX_SUMMON_GESTURE_NAME]: "fox-summon",
  [FINGER_GUN_GESTURE_NAME]: "finger-gun",
  [PIN_PULL_GESTURE_NAME]: "pin-pull-transform",
};

interface UseEffectTriggerOptions {
  gesture: GestureState;
  timestampMs: number | null;
}

/**
 * Starts a fixed-duration visual effect the moment a gesture reports
 * `phase: "triggered"`, keyed off `lastTriggeredAt` (not the phase value
 * itself) so a triggered phase that only lasts a single frame is never
 * missed. Display duration is tracked independently from the gesture's own
 * cooldown — the two happen to both be 1500ms today but are unrelated.
 * Recomputes during render (same pattern as useGestureEngine) rather than
 * via useEffect + setState.
 */
export function useEffectTrigger({
  gesture,
  timestampMs,
}: UseEffectTriggerOptions): ActiveEffect | null {
  const [activeEffect, setActiveEffect] = useState<ActiveEffect | null>(null);
  const [handledTriggerAt, setHandledTriggerAt] = useState<number | null>(null);

  const effectName = gesture.currentGestureName
    ? EFFECT_BY_GESTURE_NAME[gesture.currentGestureName]
    : undefined;

  if (
    gesture.phase === "triggered" &&
    gesture.lastTriggeredAt !== null &&
    gesture.lastTriggeredAt !== handledTriggerAt &&
    effectName
  ) {
    const nextEffect: ActiveEffect = {
      name: effectName,
      triggeredAt: gesture.lastTriggeredAt,
    };
    setActiveEffect(nextEffect);
    setHandledTriggerAt(gesture.lastTriggeredAt);
    return nextEffect;
  }

  if (
    activeEffect &&
    timestampMs !== null &&
    timestampMs - activeEffect.triggeredAt >= EFFECT_DISPLAY_DURATION_MS
  ) {
    setActiveEffect(null);
    return null;
  }

  return activeEffect;
}
