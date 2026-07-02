"use client";

import { useEffect, useRef, useState } from "react";
import type { HandLandmarker, HandLandmarkerResult } from "@mediapipe/tasks-vision";
import {
  createHandLandmarker,
  HAND_LANDMARKER_RUNNING_MODE,
} from "@/lib/mediapipe/createHandLandmarker";

export type HandLandmarkerStatus = "loading" | "ready" | "error";

interface UseHandLandmarkerOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Whether the video element already has an active, playable stream. */
  isVideoReady: boolean;
}

export interface UseHandLandmarkerResult {
  status: HandLandmarkerStatus;
  error: string | null;
  result: HandLandmarkerResult | null;
  timestampMs: number | null;
  runningMode: typeof HAND_LANDMARKER_RUNNING_MODE;
}

export function useHandLandmarker({
  videoRef,
  isVideoReady,
}: UseHandLandmarkerOptions): UseHandLandmarkerResult {
  const [status, setStatus] = useState<HandLandmarkerStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HandLandmarkerResult | null>(null);
  const [timestampMs, setTimestampMs] = useState<number | null>(null);

  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);

  useEffect(() => {
    let cancelled = false;

    createHandLandmarker()
      .then((landmarker) => {
        if (cancelled) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus("error");
        setError(
          err instanceof Error
            ? err.message
            : "손 랜드마크 모델을 불러올 수 없습니다."
        );
      });

    return () => {
      cancelled = true;
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (status !== "ready" || !isVideoReady) {
      return;
    }

    const detect = () => {
      const video = videoRef.current;
      const landmarker = landmarkerRef.current;

      if (
        video &&
        landmarker &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        video.currentTime !== lastVideoTimeRef.current
      ) {
        lastVideoTimeRef.current = video.currentTime;
        const detectedAtMs = performance.now();
        setResult(landmarker.detectForVideo(video, detectedAtMs));
        setTimestampMs(detectedAtMs);
      }

      rafIdRef.current = requestAnimationFrame(detect);
    };

    rafIdRef.current = requestAnimationFrame(detect);

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [status, isVideoReady, videoRef]);

  return { status, error, result, timestampMs, runningMode: HAND_LANDMARKER_RUNNING_MODE };
}
