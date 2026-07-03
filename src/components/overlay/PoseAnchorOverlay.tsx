"use client";

import { useEffect, useRef } from "react";
import type { PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import type { Point2D } from "@/lib/gestures/types";
import {
  estimateChestAnchor,
  estimateNeckAnchor,
  estimateShoulderCenter,
} from "@/lib/gestures/bodyAnchors";

interface PoseAnchorOverlayProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  result: PoseLandmarkerResult | null;
}

const POINT_RADIUS_PX = 4;
const LABEL_FONT = "12px monospace";
const LABEL_OFFSET_PX = 8;

const SHOULDER_COLOR = "#facc15";
const NECK_COLOR = "#f472b6";
const CHEST_COLOR = "#34d399";

/**
 * Overlays the estimated shoulder/neck/chest body anchors on a <canvas>
 * sized to the video's intrinsic resolution — same sizing/resize approach as
 * LandmarkCanvas, so both overlays stay aligned with the mirrored video
 * regardless of window size. Rendered as a sibling of LandmarkCanvas inside
 * the same mirrored wrapper, so raw (unmirrored) pose coordinates land in
 * the same place hand landmarks do.
 */
export function PoseAnchorOverlay({ videoRef, result }: PoseAnchorOverlayProps) {
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

    const poseLandmarks = result?.landmarks[0];
    if (!poseLandmarks) return;

    const shoulderCenter = estimateShoulderCenter(poseLandmarks);
    const neckAnchor = estimateNeckAnchor(poseLandmarks);
    const chestAnchor = estimateChestAnchor(poseLandmarks);

    if (shoulderCenter) {
      drawAnchor(ctx, shoulderCenter, canvas.width, canvas.height, SHOULDER_COLOR, "shoulder");
    }
    if (neckAnchor) {
      drawAnchor(ctx, neckAnchor, canvas.width, canvas.height, NECK_COLOR, "neck");
    }
    if (chestAnchor) {
      drawAnchor(ctx, chestAnchor, canvas.width, canvas.height, CHEST_COLOR, "chest");
    }
  }, [result]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full object-cover"
    />
  );
}

function drawAnchor(
  ctx: CanvasRenderingContext2D,
  point: Point2D,
  width: number,
  height: number,
  color: string,
  label: string
) {
  const x = point.x * width;
  const y = point.y * height;

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, POINT_RADIUS_PX, 0, Math.PI * 2);
  ctx.fill();

  // This canvas sits inside a CSS-mirrored (-scale-x-100) wrapper so its
  // coordinates line up with the mirrored video. That flips drawn text
  // backwards too, so counter-mirror just the label around its anchor point.
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(-1, 1);
  ctx.font = LABEL_FONT;
  ctx.fillText(label, LABEL_OFFSET_PX, -LABEL_OFFSET_PX);
  ctx.restore();
}
