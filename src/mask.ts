import type { MaskState, MaskStroke, Point } from "./types";

export const emptyMask: MaskState = {
  baseFill: 0,
  inverted: false,
  strokes: [],
};

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function distanceToSegmentSquared(point: Point, start: Point, end: Point) {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (segmentLengthSquared === 0) {
    return (point.x - start.x) ** 2 + (point.y - start.y) ** 2;
  }
  const offsetX = point.x - start.x;
  const offsetY = point.y - start.y;
  const projection = clamp(
    (offsetX * segmentX + offsetY * segmentY) / segmentLengthSquared,
  );
  const nearestX = start.x + segmentX * projection;
  const nearestY = start.y + segmentY * projection;
  return (point.x - nearestX) ** 2 + (point.y - nearestY) ** 2;
}

function strokeContains(stroke: MaskStroke, point: Point) {
  const radiusSquared = (stroke.size / 2) ** 2;
  if (stroke.points.length === 1) {
    const firstPoint = stroke.points[0];
    return firstPoint
      ? distanceToSegmentSquared(point, firstPoint, firstPoint) <= radiusSquared
      : false;
  }
  for (let index = 1; index < stroke.points.length; index += 1) {
    const start = stroke.points[index - 1];
    const end = stroke.points[index];
    if (
      start && end &&
      distanceToSegmentSquared(point, start, end) <= radiusSquared
    ) return true;
  }
  return false;
}

function applyStroke(value: number, stroke: MaskStroke) {
  if (stroke.operation === "replace") {
    const target = clamp(stroke.target ?? stroke.strength);
    return clamp(value + (target - value));
  }
  const change = stroke.strength * (stroke.operation === "add" ? 1 : -1);
  return clamp(value + change);
}

export function sampleMask(mask: MaskState, x: number, y: number) {
  const point = { x, y };
  let value = mask.baseFill;
  for (const stroke of mask.strokes) {
    if (strokeContains(stroke, point)) value = applyStroke(value, stroke);
  }
  return mask.inverted ? 1 - value : value;
}

export function estimateMaskCoverage(mask: MaskState, sampleSize = 32) {
  let total = 0;
  for (let row = 0; row < sampleSize; row += 1) {
    for (let column = 0; column < sampleSize; column += 1) {
      total += sampleMask(
        mask,
        (column + 0.5) / sampleSize,
        (row + 0.5) / sampleSize,
      );
    }
  }
  return total / (sampleSize * sampleSize);
}

export function cloneMask(mask: MaskState): MaskState {
  return {
    baseFill: mask.baseFill,
    inverted: mask.inverted,
    strokes: mask.strokes.map((stroke) => ({
      ...stroke,
      points: stroke.points.map((point) => ({ ...point })),
    })),
  };
}

const weakColor = [41, 126, 255] as const;
const lowColor = [45, 215, 235] as const;
const mediumColor = [255, 216, 64] as const;
const strongColor = [239, 54, 72] as const;

function mixColor(
  from: readonly number[],
  to: readonly number[],
  amount: number,
) {
  return [0, 1, 2].map((channel) =>
    Math.round(
      (from[channel] ?? 0) +
        ((to[channel] ?? 0) - (from[channel] ?? 0)) * amount,
    )
  );
}

export function getMaskStrengthColor(strength: number, isHatched = false) {
  const normalizedStrength = Number.isFinite(strength)
    ? Math.max(0, Math.min(1, strength))
    : 0;
  if (normalizedStrength === 0) return [0, 0, 0, 0];
  const color = normalizedStrength <= 0.33
    ? mixColor(weakColor, lowColor, normalizedStrength / 0.33)
    : normalizedStrength <= 0.55
    ? mixColor(lowColor, mediumColor, (normalizedStrength - 0.33) / 0.22)
    : mixColor(mediumColor, strongColor, (normalizedStrength - 0.55) / 0.45);
  const alpha = Math.round(
    (0.08 + normalizedStrength * 0.5) * 255 * (isHatched ? 0.68 : 1),
  );
  return [color[0] ?? 0, color[1] ?? 0, color[2] ?? 0, alpha];
}

export function getBrushStrengthColor(strength: number) {
  const [red, green, blue] = strength <= 0 || !Number.isFinite(strength)
    ? weakColor
    : getMaskStrengthColor(strength);
  return `rgb(${red} ${green} ${blue})`;
}

export function renderMaskOverlay(canvas: HTMLCanvasElement, mask: MaskState) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const width = canvas.width;
  const height = canvas.height;
  const pixels = context.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const strength = sampleMask(
        mask,
        (x + 0.5) / width,
        (y + 0.5) / height,
      );
      const pixelIndex = (y * width + x) * 4;
      const color = getMaskStrengthColor(
        strength,
        (x + Math.floor(y)) % 14 < 5,
      );
      pixels.data[pixelIndex] = color[0] ?? 0;
      pixels.data[pixelIndex + 1] = color[1] ?? 0;
      pixels.data[pixelIndex + 2] = color[2] ?? 0;
      pixels.data[pixelIndex + 3] = color[3] ?? 0;
    }
  }
  context.putImageData(pixels, 0, 0);
}
