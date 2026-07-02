"use client";

import { useWebcam } from "@/hooks/useWebcam";
import { useHandLandmarker } from "@/hooks/useHandLandmarker";
import { DebugPanel } from "@/components/debug/DebugPanel";
import { LandmarkCanvas } from "@/components/overlay/LandmarkCanvas";

export function WebcamView() {
  const { videoRef, status, error } = useWebcam();
  const handLandmarker = useHandLandmarker({
    videoRef,
    isVideoReady: status === "ready",
  });

  return (
    <div className="flex w-full max-w-2xl flex-col gap-4">
      <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-2xl bg-zinc-900">
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
      </div>

      <DebugPanel {...handLandmarker} />
    </div>
  );
}
