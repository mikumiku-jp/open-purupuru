import type { AutoMotion, Point } from "./types";

const fullCircle = Math.PI * 2;
const maximumPeriodSeconds = 1.8;

type HopTimeline = {
  period: number;
  takeoffEnd: number;
  hangEnd: number;
  fallEnd: number;
  compressionEnd: number;
  firstRecoilEnd: number;
  secondRecoilEnd: number;
  settleEnd: number;
};

function interpolateHermite(
  time: number,
  startTime: number,
  endTime: number,
  startValue: number,
  endValue: number,
  startTangent: number,
  endTangent: number,
) {
  const duration = endTime - startTime;
  const normalized = (time - startTime) / duration;
  const squared = normalized * normalized;
  const cubed = squared * normalized;
  return (2 * cubed - 3 * squared + 1) * startValue +
    (cubed - 2 * squared + normalized) * duration * startTangent +
    (-2 * cubed + 3 * squared) * endValue +
    (cubed - squared) * duration * endTangent;
}

const hopTimeline = {
  period: 0.625,
  takeoffEnd: 0.14 / 1.6,
  hangEnd: 0.24 / 1.6,
  fallEnd: 0.48 / 1.6,
  compressionEnd: 0.56 / 1.6,
  firstRecoilEnd: 0.66 / 1.6,
  secondRecoilEnd: 0.74 / 1.6,
  settleEnd: 0.84 / 1.6,
};

function getHopTimeline(periodSeconds: number): HopTimeline {
  const period = Math.max(0.2, Math.min(maximumPeriodSeconds, periodSeconds));
  if (period < 0.5) {
    const scale = period / 0.5;
    const baseline: HopTimeline = getHopTimeline(0.5);
    return {
      period,
      takeoffEnd: baseline.takeoffEnd * scale,
      hangEnd: baseline.hangEnd * scale,
      fallEnd: baseline.fallEnd * scale,
      compressionEnd: baseline.compressionEnd * scale,
      firstRecoilEnd: baseline.firstRecoilEnd * scale,
      secondRecoilEnd: baseline.secondRecoilEnd * scale,
      settleEnd: baseline.settleEnd * scale,
    };
  }
  const difference = period - hopTimeline.period;
  const shift = difference >= 0
    ? difference * 0.25
    : Math.min(0, difference + (hopTimeline.period - hopTimeline.settleEnd));
  return {
    period,
    takeoffEnd: hopTimeline.takeoffEnd,
    hangEnd: hopTimeline.hangEnd + shift,
    fallEnd: hopTimeline.fallEnd + shift,
    compressionEnd: hopTimeline.compressionEnd + shift,
    firstRecoilEnd: hopTimeline.firstRecoilEnd + shift,
    secondRecoilEnd: hopTimeline.secondRecoilEnd + shift,
    settleEnd: hopTimeline.settleEnd + shift,
  };
}

function getHopPosition(elapsedSeconds: number, periodSeconds: number) {
  const timeline = getHopTimeline(periodSeconds);
  const time = (elapsedSeconds % timeline.period + timeline.period) % timeline.period;
  const fallVelocity = 6 * 1.6 * (timeline.period < 0.5 ? 0.5 / timeline.period : 1);
  if (time < timeline.takeoffEnd) {
    const normalized = time / timeline.takeoffEnd;
    return -(normalized ** 3 * (normalized * (normalized * 6 - 15) + 10));
  }
  if (time < timeline.hangEnd) {
    const normalized = (time - timeline.takeoffEnd) /
      (timeline.hangEnd - timeline.takeoffEnd);
    return -1 + (1 - Math.cos(normalized * Math.PI)) * 0.04;
  }
  if (time < timeline.fallEnd) {
    return interpolateHermite(time, timeline.hangEnd, timeline.fallEnd, -0.92, 0, 0, fallVelocity);
  }
  if (time < timeline.compressionEnd) {
    return interpolateHermite(time, timeline.fallEnd, timeline.compressionEnd, 0, 0.22, fallVelocity, 0);
  }
  if (time < timeline.firstRecoilEnd) {
    return interpolateHermite(time, timeline.compressionEnd, timeline.firstRecoilEnd, 0.22, -0.065, 0, 0);
  }
  if (time < timeline.secondRecoilEnd) {
    return interpolateHermite(time, timeline.firstRecoilEnd, timeline.secondRecoilEnd, -0.065, 0.035, 0, 0);
  }
  if (time < timeline.settleEnd) {
    return interpolateHermite(time, timeline.secondRecoilEnd, timeline.settleEnd, 0.035, 0, 0, 0);
  }
  return 0;
}

function getSeededUnit(seed: number, index: number) {
  let mixed = (seed ^ Math.imul(index + 1, 2654435761)) >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 2146121005);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 2221713035);
  mixed ^= mixed >>> 16;
  return mixed / 4294967295;
}

export function resolveAutomaticAmplitude(strengthPercent: number) {
  const strength = Number.isFinite(strengthPercent)
    ? Math.max(0, Math.min(100, strengthPercent))
    : 0;
  const stops = [
    { percent: 0, amplitude: 0 },
    { percent: 25, amplitude: 0.3 },
    { percent: 50, amplitude: 0.6 },
    { percent: 80, amplitude: 0.84 },
    { percent: 100, amplitude: 1 },
  ];
  for (let index = 1; index < stops.length; index += 1) {
    const next = stops[index];
    const previous = stops[index - 1];
    if (!next || !previous || strength > next.percent) continue;
    const progress = (strength - previous.percent) / (next.percent - previous.percent);
    return previous.amplitude + (next.amplitude - previous.amplitude) * progress;
  }
  return 1;
}

export function getAutomaticMotionTarget(
  motion: AutoMotion,
  elapsedSeconds: number,
  strengthPercent: number,
  periodMilliseconds: number,
) {
  if (!motion) return { x: 0, y: 0 };
  const amplitude = resolveAutomaticAmplitude(strengthPercent);
  if (amplitude === 0) return { x: 0, y: 0 };
  const periodSeconds = Math.max(0.2, Math.min(1.8, periodMilliseconds / 1000));
  const phase = elapsedSeconds / periodSeconds * fullCircle;
  if (motion === "hop") {
    return {
      x: Math.sin(phase) * (getSeededUnit(1347768917, 0) - 0.5) * 0.025 * amplitude,
      y: getHopPosition(elapsedSeconds, periodSeconds) * amplitude,
    };
  }
  if (motion === "orbit") {
    const adjustedPhase = phase + Math.sin(phase) * 0.22;
    const radius = amplitude * (0.89 + Math.sin(phase * 0.5) * 0.11);
    return { x: Math.cos(adjustedPhase) * radius, y: Math.sin(adjustedPhase) * radius };
  }
  return {
    x: -Math.tanh(Math.cos(phase) * 2.2) / Math.tanh(2.2) * amplitude,
    y: 0,
  };
}

export function getManualDragTarget(start: Point, current: Point, shortSide: number) {
  if (!(shortSide > 0) || !Number.isFinite(shortSide)) return { x: 0, y: 0 };
  const target = {
    x: (current.x - start.x) / shortSide * 0.32,
    y: (current.y - start.y) / shortSide * 0.32,
  };
  const magnitude = Math.hypot(target.x, target.y);
  if (!Number.isFinite(magnitude)) return { x: 0, y: 0 };
  if (magnitude <= 0.08 || magnitude === 0) return target;
  const scale = 0.08 / magnitude;
  return { x: target.x * scale, y: target.y * scale };
}
