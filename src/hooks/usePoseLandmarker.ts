"use client";

import { useEffect, useRef, useState } from "react";
import type { PoseLandmarker, PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import {
  createPoseLandmarker,
  POSE_LANDMARKER_RUNNING_MODE,
} from "@/lib/mediapipe/createPoseLandmarker";

export type PoseLandmarkerStatus = "loading" | "ready" | "error";

interface UsePoseLandmarkerOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Whether the video element already has an active, playable stream. */
  isVideoReady: boolean;
  /**
   * Run detectForVideo once every N new video frames instead of every frame.
   * Pose estimation is heavier than hand tracking and the anchors derived
   * from it (neck/chest points) don't need per-frame precision, so skipping
   * frames trades a little latency for meaningfully less CPU/GPU work.
   * Defaults to 3 (i.e. detect on 1 out of every 3 frames).
   */
  frameInterval?: number;
}

export interface UsePoseLandmarkerResult {
  status: PoseLandmarkerStatus;
  error: string | null;
  result: PoseLandmarkerResult | null;
  timestampMs: number | null;
  runningMode: typeof POSE_LANDMARKER_RUNNING_MODE;
}

const DEFAULT_FRAME_INTERVAL = 3;

export function usePoseLandmarker({
  videoRef,
  isVideoReady,
  frameInterval = DEFAULT_FRAME_INTERVAL,
}: UsePoseLandmarkerOptions): UsePoseLandmarkerResult {
  const [status, setStatus] = useState<PoseLandmarkerStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PoseLandmarkerResult | null>(null);
  const [timestampMs, setTimestampMs] = useState<number | null>(null);

  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const newFrameCountRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    createPoseLandmarker()
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
            : "몸 랜드마크 모델을 불러올 수 없습니다."
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
        newFrameCountRef.current += 1;

        if (newFrameCountRef.current % frameInterval === 0) {
          const detectedAtMs = performance.now();
          setResult(landmarker.detectForVideo(video, detectedAtMs));
          setTimestampMs(detectedAtMs);
        }
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
  }, [status, isVideoReady, videoRef, frameInterval]);

  return { status, error, result, timestampMs, runningMode: POSE_LANDMARKER_RUNNING_MODE };
}
