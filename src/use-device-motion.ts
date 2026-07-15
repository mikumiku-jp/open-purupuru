import { useCallback, useEffect, useRef, useState } from "react";
import type { Point } from "./types";

type MotionState = {
  gravity: Point;
  gravityInitialized: boolean;
  smoothed: Point;
  velocity: Point;
  position: Point;
};

type MotionStatus = "off" | "unsupported" | "requesting" | "denied" | "waiting" | "active";

type MotionDebug = {
  eventHz: number;
  screenAngle: number;
  source: "none" | "gravity-fallback" | "linear-acceleration";
};

type MotionPermissionConstructor = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

const zeroPoint = { x: 0, y: 0 };
const maximumPosition = 0.08;

function createMotionState(): MotionState {
  return {
    gravity: { ...zeroPoint },
    gravityInitialized: false,
    smoothed: { ...zeroPoint },
    velocity: { ...zeroPoint },
    position: { ...zeroPoint },
  };
}

function clampVector(point: Point, maximumLength: number): Point {
  const length = Math.hypot(point.x, point.y);
  if (!Number.isFinite(length)) return { ...zeroPoint };
  if (length <= maximumLength || length === 0) return point;
  const scale = maximumLength / length;
  return { x: point.x * scale, y: point.y * scale };
}

function applyDeadZone(point: Point, threshold: number): Point {
  const length = Math.hypot(point.x, point.y);
  if (!Number.isFinite(length) || length <= threshold) return { ...zeroPoint };
  const scale = Math.min(1, (length - threshold) / (1 - threshold)) / length;
  return { x: point.x * scale, y: point.y * scale };
}

function rotateAcceleration(point: Point, screenAngle: number): Point {
  const angle = (screenAngle % 360 + 360) % 360;
  const rotated = angle === 90
    ? { x: -point.y, y: point.x }
    : angle === 180
    ? { x: -point.x, y: -point.y }
    : angle === 270
    ? { x: point.y, y: -point.x }
    : point;
  return { x: rotated.x, y: -rotated.y };
}

function resolveMotionTarget(
  acceleration: Point & {
    includesGravity: boolean;
    screenAngle: number;
    intervalSeconds: number;
  },
  currentState: MotionState,
  sensitivity: number,
) {
  const intervalSeconds = Number.isFinite(acceleration.intervalSeconds)
    ? Math.max(1 / 240, Math.min(0.1, acceleration.intervalSeconds))
    : 1 / 60;
  const gravityDecay = Math.exp(-intervalSeconds / 0.22);
  const gravity = acceleration.includesGravity
    ? currentState.gravityInitialized
      ? {
        x: currentState.gravity.x * gravityDecay + acceleration.x * (1 - gravityDecay),
        y: currentState.gravity.y * gravityDecay + acceleration.y * (1 - gravityDecay),
      }
      : { x: acceleration.x, y: acceleration.y }
    : currentState.gravity;
  const linearAcceleration = acceleration.includesGravity
    ? currentState.gravityInitialized
      ? { x: acceleration.x - gravity.x, y: acceleration.y - gravity.y }
      : { ...zeroPoint }
    : { x: acceleration.x, y: acceleration.y };
  const rotated = rotateAcceleration(linearAcceleration, acceleration.screenAngle);
  const accelerationScale = Math.max(0.25, Math.min(2, sensitivity)) / 9.81;
  const normalized = applyDeadZone(clampVector({
    x: rotated.x * accelerationScale,
    y: rotated.y * accelerationScale,
  }, 1), 0.045);
  const smoothing = 1 - Math.exp(-intervalSeconds / 0.04);
  const smoothed = {
    x: currentState.smoothed.x + (normalized.x - currentState.smoothed.x) * smoothing,
    y: currentState.smoothed.y + (normalized.y - currentState.smoothed.y) * smoothing,
  };
  const accelerationForce = {
    x: smoothed.x * 10 - currentState.position.x * 24 - currentState.velocity.x * 5.5,
    y: smoothed.y * 10 - currentState.position.y * 24 - currentState.velocity.y * 5.5,
  };
  const velocity = {
    x: currentState.velocity.x + accelerationForce.x * intervalSeconds,
    y: currentState.velocity.y + accelerationForce.y * intervalSeconds,
  };
  const unclampedPosition = {
    x: currentState.position.x + velocity.x * intervalSeconds,
    y: currentState.position.y + velocity.y * intervalSeconds,
  };
  const position = clampVector(unclampedPosition, maximumPosition);
  if (position.x !== unclampedPosition.x || position.y !== unclampedPosition.y) {
    const outwardVelocity = velocity.x * position.x + velocity.y * position.y;
    if (outwardVelocity > 0) {
      const squaredLength = position.x * position.x + position.y * position.y;
      if (squaredLength > 0) {
        velocity.x -= outwardVelocity / squaredLength * position.x;
        velocity.y -= outwardVelocity / squaredLength * position.y;
      }
    }
  }
  return {
    target: position,
    state: {
      gravity,
      gravityInitialized: currentState.gravityInitialized || acceleration.includesGravity,
      smoothed,
      velocity,
      position,
    },
  };
}

export function useDeviceMotion(onTarget: (target: Point) => void, sensitivity = 1) {
  const isAvailable = typeof window !== "undefined" && "DeviceMotionEvent" in window;
  const [status, setStatus] = useState<MotionStatus>(isAvailable ? "off" : "unsupported");
  const [frameTarget, setFrameTarget] = useState<Point>({ ...zeroPoint });
  const [debug, setDebug] = useState<MotionDebug>({
    eventHz: 0,
    screenAngle: 0,
    source: "none",
  });
  const motionStateRef = useRef(createMotionState());
  const lastEventTimeRef = useRef(0);
  const lastActiveTimeRef = useRef(0);
  const onTargetRef = useRef(onTarget);
  onTargetRef.current = onTarget;

  const handleMotion = useCallback((event: DeviceMotionEvent) => {
    const linear = event.acceleration;
    const gravityFallback = event.accelerationIncludingGravity;
    const source = linear?.x != null || linear?.y != null ? linear : gravityFallback;
    if (!source) return;
    const now = performance.now();
    const elapsedSeconds = lastEventTimeRef.current > 0
      ? (now - lastEventTimeRef.current) / 1000
      : 0;
    const eventInterval = Number.isFinite(event.interval) && event.interval > 0
      ? event.interval / 1000
      : 0;
    const intervalSeconds = elapsedSeconds || eventInterval || 1 / 60;
    const screenAngle = window.screen.orientation?.angle ??
      (window as Window & { orientation?: number }).orientation ?? 0;
    const resolved = resolveMotionTarget({
      x: source.x ?? 0,
      y: source.y ?? 0,
      includesGravity: source === gravityFallback,
      screenAngle,
      intervalSeconds,
    }, motionStateRef.current, sensitivity);
    motionStateRef.current = resolved.state;
    lastActiveTimeRef.current = now;
    lastEventTimeRef.current = now;
    setFrameTarget(resolved.target);
    setDebug({
      eventHz: 1 / Math.max(1 / 240, intervalSeconds),
      screenAngle,
      source: source === gravityFallback
        ? "gravity-fallback"
        : "linear-acceleration",
    });
    onTargetRef.current(resolved.target);
    setStatus("active");
  }, [sensitivity]);

  const disable = useCallback(() => {
    window.removeEventListener("devicemotion", handleMotion);
    motionStateRef.current = createMotionState();
    lastEventTimeRef.current = 0;
    setFrameTarget({ ...zeroPoint });
    setDebug({ eventHz: 0, screenAngle: 0, source: "none" });
    onTargetRef.current({ ...zeroPoint });
    setStatus(isAvailable ? "off" : "unsupported");
  }, [handleMotion, isAvailable]);

  const enable = useCallback(async () => {
    if (!isAvailable) {
      setStatus("unsupported");
      return;
    }
    setStatus("requesting");
    const motionConstructor = DeviceMotionEvent as MotionPermissionConstructor;
    try {
      const permission = motionConstructor.requestPermission
        ? await motionConstructor.requestPermission()
        : "granted";
      if (permission !== "granted") {
        setStatus("denied");
        return;
      }
      motionStateRef.current = createMotionState();
      lastEventTimeRef.current = 0;
      setFrameTarget({ ...zeroPoint });
      setDebug({ eventHz: 0, screenAngle: 0, source: "none" });
      onTargetRef.current({ ...zeroPoint });
      lastActiveTimeRef.current = performance.now();
      setStatus("waiting");
      window.addEventListener("devicemotion", handleMotion);
    } catch {
      setStatus("denied");
    }
  }, [handleMotion, isAvailable]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) disable();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("devicemotion", handleMotion);
    };
  }, [disable, handleMotion]);

  useEffect(() => {
    if (status !== "active") return;
    const timeout = window.setInterval(() => {
      if (performance.now() - lastActiveTimeRef.current <= 500) return;
      motionStateRef.current = createMotionState();
      lastEventTimeRef.current = 0;
      setFrameTarget({ ...zeroPoint });
      setDebug((current) => ({ ...current, eventHz: 0 }));
      onTargetRef.current({ ...zeroPoint });
      setStatus("waiting");
    }, 250);
    return () => window.clearInterval(timeout);
  }, [status]);

  return { status, frameTarget, debug, isAvailable, enable, disable };
}
