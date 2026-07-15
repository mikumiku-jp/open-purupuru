import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  getAutomaticMotionTarget,
  getManualDragTarget,
  resolveAutomaticAmplitude,
} from "../automatic-motion";
import { canvasLocales } from "../canvas-locales";
import {
  getEffectiveMaskCoverage,
  WobblePhysics,
} from "../physics";
import type { PhysicsInput, PhysicsInputEvent } from "../physics";
import { WobbleRenderer } from "../webgl-renderer";
import type {
  AutoMotion,
  LoadedImage,
  Language,
  MaskState,
  Point,
  WobbleParameters,
  WobbleSurfaceHandle,
} from "../types";

type Props = {
  image: LoadedImage;
  mask: MaskState;
  parameters: WobbleParameters;
  autoMotion: AutoMotion;
  autoStrength: number;
  autoPeriodMs: number;
  sensorTarget: Point;
  language: Language;
};

export const WobbleCanvas = forwardRef<WobbleSurfaceHandle, Props>(
  function WobbleCanvas(
    {
      image,
      mask,
      parameters,
      autoMotion,
      autoStrength,
      autoPeriodMs,
      sensorTarget,
      language,
    },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const physicsRef = useRef<WobblePhysics | null>(null);
    const rendererRef = useRef<WobbleRenderer | null>(null);
    const captureRef = useRef<{
      startTick: number;
      events: PhysicsInputEvent[];
    } | null>(null);
    const manualTargetRef = useRef<Point>({ x: 0, y: 0 });
    const dragStartRef = useRef<Point | null>(null);
    const activePointerRef = useRef<number | null>(null);
    const animationOptionsRef = useRef({
      autoMotion,
      autoStrength,
      autoPeriodMs,
      sensorTarget,
    });
    const [error, setError] = useState<string | null>(null);
    const [isRestoring, setIsRestoring] = useState(false);
    const canvasCopy = canvasLocales[language];

    animationOptionsRef.current = {
      autoMotion,
      autoStrength,
      autoPeriodMs,
      sensorTarget,
    };

    useImperativeHandle(ref, () => ({
      getCanvas: () => {
        const canvas = canvasRef.current;
        if (!canvas) throw new Error("Wobble canvas is unavailable");
        return canvas;
      },
      getFrameOffset: () =>
        physicsRef.current?.getFrameOffset() ?? { x: 0, y: 0 },
      startCapture: () => {
        const physics = physicsRef.current;
        if (!physics) throw new Error("Wobble physics is unavailable");
        const snapshot = physics.createSnapshot();
        captureRef.current = { startTick: snapshot.tick, events: [] };
        return structuredClone(snapshot);
      },
      stopCapture: () => {
        const capture = captureRef.current;
        captureRef.current = null;
        return capture?.events.splice(0) ?? [];
      },
    }), []);

    useEffect(() => {
      physicsRef.current?.setParameters(parameters);
    }, [parameters]);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      let animationFrame = 0;
      let isDisposed = false;
      let isContextLost = false;
      let previousTime = performance.now();
      let automaticElapsedSeconds = 0;
      const physics = new WobblePhysics(
        image.width,
        image.height,
        mask,
        parameters,
      );
      physicsRef.current = physics;
      const canvasScale = Math.min(1, 960 / Math.max(image.width, image.height));
      canvas.width = Math.max(2, Math.round(image.width * canvasScale));
      canvas.height = Math.max(2, Math.round(image.height * canvasScale));
      let renderer: WobbleRenderer;
      const createRenderer = () => new WobbleRenderer(canvas, image, physics);
      try {
        renderer = createRenderer();
        rendererRef.current = renderer;
        setError(null);
      } catch {
        setError(canvasCopy.unavailable);
        return;
      }
      const handleContextLost = (event: Event) => {
        event.preventDefault();
        if (isDisposed) return;
        isContextLost = true;
        setIsRestoring(true);
      };
      const handleContextRestored = () => {
        if (isDisposed) return;
        try {
          renderer.dispose();
          renderer = createRenderer();
          rendererRef.current = renderer;
          isContextLost = false;
          setIsRestoring(false);
        } catch {
          rendererRef.current = null;
          setError(canvasCopy.unavailable);
        }
      };
      canvas.addEventListener("webglcontextlost", handleContextLost);
      canvas.addEventListener("webglcontextrestored", handleContextRestored);
      const maskCoverage = getEffectiveMaskCoverage(physics.mesh.weights);

      const animate = (currentTime: number) => {
        const deltaSeconds = Math.min(
          0.05,
          Math.max(0, (currentTime - previousTime) / 1000),
        );
        previousTime = currentTime;
        const options = animationOptionsRef.current;
        const sensorMagnitude = Math.hypot(
          options.sensorTarget.x,
          options.sensorTarget.y,
        );
        const hasManualInput = activePointerRef.current !== null;
        const hasSensorInput = sensorMagnitude > 0.0005;
        const hasExternalInput = hasManualInput || hasSensorInput;
        if (!hasExternalInput) automaticElapsedSeconds += deltaSeconds;
        const automatic = getAutomaticMotionTarget(
          options.autoMotion,
          automaticElapsedSeconds,
          options.autoStrength,
          options.autoPeriodMs,
        );
        const hasAutomaticInput = options.autoMotion !== null &&
          resolveAutomaticAmplitude(options.autoStrength) > 0 &&
          !hasExternalInput;
        const target = hasManualInput
          ? manualTargetRef.current
          : hasSensorInput
          ? options.sensorTarget
          : hasAutomaticInput
          ? {
            x: automatic.x * 0.16 * maskCoverage,
            y: automatic.y * 0.16 * maskCoverage,
          }
          : { x: 0, y: 0 };
        const physicsInput: PhysicsInput = {
          frameTarget: target,
          frameDragging: hasManualInput || hasSensorInput || hasAutomaticInput,
          frameTravelLimit: hasAutomaticInput ? 0.16 : undefined,
          localAcceleration: { x: 0, y: 0 },
          automaticAcceleration: { x: 0, y: 0 },
        };
        physics.advance(deltaSeconds, (tick) => {
          const capture = captureRef.current;
          if (capture) {
            capture.events.push({
              tick: Math.max(0, tick - capture.startTick),
              type: "physics-input",
              payload: {
                frameDragging: physicsInput.frameDragging ?? false,
                frameTarget: { ...(physicsInput.frameTarget ?? { x: 0, y: 0 }) },
                frameTravelLimit: physicsInput.frameTravelLimit,
                localAcceleration: {
                  ...(physicsInput.localAcceleration ?? { x: 0, y: 0 }),
                },
                automaticAcceleration: {
                  ...(physicsInput.automaticAcceleration ?? { x: 0, y: 0 }),
                },
              },
            });
          }
          return physicsInput;
        });
        if (!isContextLost) {
          try {
            renderer.render(physics.getFrameOffset());
          } catch {
            setError(canvasCopy.unavailable);
            return;
          }
        }
        animationFrame = requestAnimationFrame(animate);
      };
      animationFrame = requestAnimationFrame(animate);

      return () => {
        isDisposed = true;
        cancelAnimationFrame(animationFrame);
        canvas.removeEventListener("webglcontextlost", handleContextLost);
        canvas.removeEventListener("webglcontextrestored", handleContextRestored);
        renderer.dispose();
        rendererRef.current = null;
        physicsRef.current = null;
        captureRef.current = null;
      };
    }, [canvasCopy.unavailable, image, mask]);

    function startDrag(event: React.PointerEvent<HTMLCanvasElement>) {
      event.currentTarget.setPointerCapture(event.pointerId);
      activePointerRef.current = event.pointerId;
      dragStartRef.current = { x: event.clientX, y: event.clientY };
      manualTargetRef.current = { x: 0, y: 0 };
    }

    function moveDrag(event: React.PointerEvent<HTMLCanvasElement>) {
      if (
        activePointerRef.current !== event.pointerId || !dragStartRef.current
      ) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const normalization = Math.max(1, Math.min(bounds.width, bounds.height));
      manualTargetRef.current = getManualDragTarget(
        dragStartRef.current,
        { x: event.clientX, y: event.clientY },
        normalization,
      );
    }

    function finishDrag(event: React.PointerEvent<HTMLCanvasElement>) {
      if (activePointerRef.current !== event.pointerId) return;
      activePointerRef.current = null;
      dragStartRef.current = null;
      manualTargetRef.current = { x: 0, y: 0 };
    }

    return (
      <div className="play-workspace">
        {error ? <div className="feature-error" role="alert">! {error}</div> : null}
        {!error && isRestoring
          ? <div className="feature-status" role="status">{canvasCopy.restoring}</div>
          : null}
        <div
          className="play-stage"
          data-image-aspect={`${image.width}:${image.height}`}
          style={{
            aspectRatio: `${image.width} / ${image.height}`,
            maxWidth: `${Math.min(620, 620 * image.width / image.height)}px`,
          }}
        >
          <canvas
            ref={canvasRef}
            className="play-canvas"
            style={{ aspectRatio: `${image.width} / ${image.height}` }}
            aria-label={canvasCopy.canvas}
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
          />
        </div>
      </div>
    );
  },
);
