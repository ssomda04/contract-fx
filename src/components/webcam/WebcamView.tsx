"use client";

import { useWebcam } from "@/hooks/useWebcam";

export function WebcamView() {
  const { videoRef, status, error } = useWebcam();

  return (
    <div className="relative flex aspect-video w-full max-w-2xl items-center justify-center overflow-hidden rounded-2xl bg-zinc-900">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`h-full w-full object-cover ${
          status === "ready" ? "opacity-100" : "opacity-0"
        }`}
      />
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
  );
}
