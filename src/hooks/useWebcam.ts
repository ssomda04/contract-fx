"use client";

import { useEffect, useRef, useState } from "react";

export type WebcamStatus = "loading" | "ready" | "error";

interface UseWebcamResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  status: WebcamStatus;
  error: string | null;
}

function isWebcamSupported(): boolean {
  return (
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia
  );
}

export function useWebcam(): UseWebcamResult {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<WebcamStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    const request = isWebcamSupported()
      ? navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      : Promise.reject(
          new Error("이 브라우저는 웹캠 접근을 지원하지 않습니다.")
        );

    request
      .then((mediaStream) => {
        if (cancelled) {
          mediaStream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = mediaStream;
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus("error");
        setError(
          err instanceof Error ? err.message : "웹캠에 접근할 수 없습니다."
        );
      });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return { videoRef, status, error };
}
