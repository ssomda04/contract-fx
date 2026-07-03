"use client";

import { useWebcam } from "@/hooks/useWebcam";
import { useHandLandmarker } from "@/hooks/useHandLandmarker";
import { usePoseLandmarker } from "@/hooks/usePoseLandmarker";
import { useGestureEngine } from "@/hooks/useGestureEngine";
import { useEffectTrigger } from "@/hooks/useEffectTrigger";
import { DebugPanel } from "@/components/debug/DebugPanel";
import { LandmarkCanvas } from "@/components/overlay/LandmarkCanvas";
import { PoseAnchorOverlay } from "@/components/overlay/PoseAnchorOverlay";
import { EffectLayer } from "@/components/effects/EffectLayer";
import type { ActiveEffect } from "@/lib/effects/types";

const SHAKE_DURATION_MS = 400;
const SHAKE_AMPLITUDE_PX = 4;

/**
 * Decaying oscillation offset for the brief screen-shake, derived purely
 * from (activeEffect, timestampMs) so it needs no timer/effect of its own —
 * it just rides the same per-frame re-render as everything else here.
 */
function getShakeOffsetPx(activeEffect: ActiveEffect | null, timestampMs: number | null) {
  if (!activeEffect || timestampMs === null) return { x: 0, y: 0 };

  const elapsedMs = timestampMs - activeEffect.triggeredAt;
  if (elapsedMs < 0 || elapsedMs > SHAKE_DURATION_MS) return { x: 0, y: 0 };

  const progress = elapsedMs / SHAKE_DURATION_MS;
  const decay = 1 - progress;
  const angle = progress * Math.PI * 8;

  return {
    x: Math.sin(angle) * SHAKE_AMPLITUDE_PX * decay,
    y: Math.cos(angle * 1.3) * SHAKE_AMPLITUDE_PX * decay,
  };
}

export function WebcamView() {
  const { videoRef, status, error } = useWebcam();
  const handLandmarker = useHandLandmarker({
    videoRef,
    isVideoReady: status === "ready",
  });
  const poseLandmarker = usePoseLandmarker({
    videoRef,
    isVideoReady: status === "ready",
  });
  const gesture = useGestureEngine({
    result: handLandmarker.result,
    poseResult: poseLandmarker.result,
    timestampMs: handLandmarker.timestampMs,
  });
  const activeEffect = useEffectTrigger({
    gesture,
    timestampMs: handLandmarker.timestampMs,
  });

  const shake = getShakeOffsetPx(activeEffect, handLandmarker.timestampMs);

  return (
    <div className="flex w-full max-w-2xl flex-col gap-4">
      <div
        className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-2xl bg-zinc-900"
        style={{ transform: `translate(${shake.x}px, ${shake.y}px)` }}
      >
        {/* Mirrored like a selfie camera; video and canvas share this
            wrapper so the landmark overlay always stays aligned with it. */}
        <div className="absolute inset-0 -scale-x-100">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`h-full w-full object-cover ${
              status === "ready" ? "opacity-100" : "opacity-0"
            }`}
          />
          <LandmarkCanvas videoRef={videoRef} result={handLandmarker.result} />
          <PoseAnchorOverlay videoRef={videoRef} result={poseLandmarker.result} />
        </div>
        {status === "loading" && (
          <p className="absolute text-sm text-zinc-300">
            카메라를 불러오는 중...
          </p>
        )}
        {status === "error" && (
          <p className="absolute max-w-xs px-4 text-center text-sm text-red-400">
            {error ?? "웹캠을 사용할 수 없습니다."}
          </p>
        )}
        <EffectLayer effect={activeEffect} />
      </div>

      <DebugPanel {...handLandmarker} gesture={gesture} pose={poseLandmarker} />
    </div>
  );
}
