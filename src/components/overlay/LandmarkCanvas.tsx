"use client";

import { useEffect, useRef } from "react";
import type { HandLandmarkerResult, NormalizedLandmark } from "@mediapipe/tasks-vision";
import { HAND_CONNECTIONS } from "@/lib/mediapipe/handConnections";

interface LandmarkCanvasProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  result: HandLandmarkerResult | null;
}

const POINT_RADIUS_PX = 3;
const POINT_COLOR = "#22d3ee";
const LINE_WIDTH_PX = 1.5;
const LINE_COLOR = "rgba(34, 211, 238, 0.7)";

/**
 * Overlays hand landmarks on a <canvas> sized to the video's intrinsic
 * resolution. The canvas is styled with the same box + `object-cover` as the
 * <video> it sits on top of, so the browser scales/crops both identically —
 * no manual resize math needed for container or window resizes.
 */
export function LandmarkCanvas({ videoRef, result }: LandmarkCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const syncCanvasResolution = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
    };

    syncCanvasResolution();
    video.addEventListener("loadedmetadata", syncCanvasResolution);
    video.addEventListener("resize", syncCanvasResolution);

    return () => {
      video.removeEventListener("loadedmetadata", syncCanvasResolution);
      video.removeEventListener("resize", syncCanvasResolution);
    };
  }, [videoRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!result) return;

    for (const landmarks of result.landmarks) {
      drawConnections(ctx, landmarks, canvas.width, canvas.height);
      drawPoints(ctx, landmarks, canvas.width, canvas.height);
    }
  }, [result]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full object-cover"
    />
  );
}

function drawPoints(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  width: number,
  height: number
) {
  ctx.fillStyle = POINT_COLOR;
  for (const { x, y } of landmarks) {
    ctx.beginPath();
    ctx.arc(x * width, y * height, POINT_RADIUS_PX, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawConnections(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  width: number,
  height: number
) {
  ctx.strokeStyle = LINE_COLOR;
  ctx.lineWidth = LINE_WIDTH_PX;
  ctx.beginPath();
  for (const { start, end } of HAND_CONNECTIONS) {
    const from = landmarks[start];
    const to = landmarks[end];
    if (!from || !to) continue;
    ctx.moveTo(from.x * width, from.y * height);
    ctx.lineTo(to.x * width, to.y * height);
  }
  ctx.stroke();
}
