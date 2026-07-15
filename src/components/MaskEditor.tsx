import { useEffect, useMemo, useRef, useState } from "react";
import {
  cloneMask,
  emptyMask,
  estimateMaskCoverage,
  getBrushStrengthColor,
  renderMaskOverlay,
} from "../mask";
import { useI18n } from "../i18n";
import { accessibilityLocales } from "../accessibility-locales";
import { recordingLocales } from "../recording-locales";
import type {
  BrushMode,
  LoadedImage,
  MaskState,
  MaskStroke,
  Point,
} from "../types";

type Props = {
  image: LoadedImage | null;
  onViewerFiles: (files: FileList) => void;
  onMaskChange: (mask: MaskState) => void;
};

type PointerAction =
  | { kind: "stroke"; pointerId: number; stroke: MaskStroke }
  | { kind: "pan"; pointerId: number; origin: Point; startPan: Point }
  | { kind: "touch-pan"; pointerIds: number[]; origin: Point; startPan: Point };

function getTouchCentroid(activePointers: Map<number, Point>) {
  const touchPoints = [...activePointers.values()].slice(0, 2);
  if (touchPoints.length < 2) return null;
  const firstPoint = touchPoints[0];
  const secondPoint = touchPoints[1];
  if (!firstPoint || !secondPoint) return null;
  return {
    x: (firstPoint.x + secondPoint.x) / 2,
    y: (firstPoint.y + secondPoint.y) / 2,
  };
}

export function MaskEditor({ image, onViewerFiles, onMaskChange }: Props) {
  const { copy, language } = useI18n();
  const accessibilityCopy = accessibilityLocales[language];
  const recordingCopy = recordingLocales[language];
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const strokeIdRef = useRef(1);
  const activePointersRef = useRef(new Map<number, Point>());
  const [history, setHistory] = useState<MaskState[]>([cloneMask(emptyMask)]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [brushMode, setBrushMode] = useState<BrushMode>("paint");
  const [brushSize, setBrushSize] = useState(0.06);
  const [brushStrength, setBrushStrength] = useState(1);
  const [pointerAction, setPointerAction] = useState<PointerAction | null>(
    null,
  );
  const [cursorPoint, setCursorPoint] = useState<Point | null>(null);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isFileOver, setIsFileOver] = useState(false);
  const [inputType, setInputType] = useState<"desktop" | "touch">(() =>
    matchMedia("(pointer: coarse)").matches ? "touch" : "desktop"
  );
  const committedMask = history[historyIndex] ?? emptyMask;
  const visibleMask = pointerAction?.kind === "stroke"
    ? {
      ...committedMask,
      strokes: [...committedMask.strokes, pointerAction.stroke],
    }
    : committedMask;
  const coverage = useMemo(() => estimateMaskCoverage(committedMask), [
    committedMask,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space" && event.target === document.body) {
        event.preventDefault();
        setIsSpacePressed(true);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      if (event.key === "[" || event.key === "]") {
        setBrushSize((current) =>
          Math.min(
            0.2,
            Math.max(0.01, current + (event.key === "]" ? 0.01 : -0.01)),
          )
        );
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") setIsSpacePressed(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  });

  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas || !image) return;
    const maximumSide = 320;
    const scale = Math.min(
      1,
      maximumSide / Math.max(image.width, image.height),
    );
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    renderMaskOverlay(canvas, visibleMask);
  }, [image, visibleMask]);

  function commitMask(nextMask: MaskState) {
    const nextHistory = [
      ...history.slice(0, historyIndex + 1),
      cloneMask(nextMask),
    ];
    setHistory(nextHistory);
    setHistoryIndex(nextHistory.length - 1);
    onMaskChange(nextMask);
  }

  function undo() {
    if (historyIndex <= 0) return;
    const nextIndex = historyIndex - 1;
    setHistoryIndex(nextIndex);
    onMaskChange(history[nextIndex] ?? emptyMask);
  }

  function redo() {
    if (historyIndex >= history.length - 1) return;
    const nextIndex = historyIndex + 1;
    setHistoryIndex(nextIndex);
    onMaskChange(history[nextIndex] ?? emptyMask);
  }

  function getNormalizedPoint(event: React.PointerEvent) {
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0 || bounds.height === 0) return null;
    const point = {
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height,
    };
    if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return null;
    return point;
  }

  function startPointerAction(event: React.PointerEvent) {
    if (!image) return;
    setInputType(event.pointerType === "touch" ? "touch" : "desktop");
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.pointerType === "touch") {
      activePointersRef.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      const touchCentroid = getTouchCentroid(activePointersRef.current);
      if (touchCentroid) {
        setPointerAction({
          kind: "touch-pan",
          pointerIds: [...activePointersRef.current.keys()].slice(0, 2),
          origin: touchCentroid,
          startPan: pan,
        });
        setCursorPoint(null);
        return;
      }
    }
    const shouldPan = event.button === 1 || isSpacePressed;
    if (shouldPan) {
      setPointerAction({
        kind: "pan",
        pointerId: event.pointerId,
        origin: { x: event.clientX, y: event.clientY },
        startPan: pan,
      });
      return;
    }
    const point = getNormalizedPoint(event);
    if (!point) return;
    const isPaint = brushMode === "paint";
    const stroke: MaskStroke = {
      id: strokeIdRef.current,
      mode: brushMode,
      operation: isPaint
        ? "replace"
        : committedMask.inverted
        ? "add"
        : "subtract",
      points: [point],
      size: brushSize,
      strength: brushStrength,
      target: isPaint
        ? committedMask.inverted ? 1 - brushStrength : brushStrength
        : undefined,
    };
    strokeIdRef.current += 1;
    setPointerAction({ kind: "stroke", pointerId: event.pointerId, stroke });
    setCursorPoint(point);
  }

  function movePointerAction(event: React.PointerEvent) {
    setInputType(event.pointerType === "touch" ? "touch" : "desktop");
    if (event.pointerType === "touch" && activePointersRef.current.has(event.pointerId)) {
      activePointersRef.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
    }
    if (!pointerAction) {
      setCursorPoint(getNormalizedPoint(event));
      return;
    }
    if (pointerAction.kind === "touch-pan") {
      if (!pointerAction.pointerIds.includes(event.pointerId)) return;
      const touchCentroid = getTouchCentroid(activePointersRef.current);
      if (!touchCentroid) return;
      setPan({
        x: pointerAction.startPan.x + touchCentroid.x - pointerAction.origin.x,
        y: pointerAction.startPan.y + touchCentroid.y - pointerAction.origin.y,
      });
      return;
    }
    if (pointerAction.pointerId !== event.pointerId) return;
    if (pointerAction.kind === "pan") {
      setPan({
        x: pointerAction.startPan.x + event.clientX - pointerAction.origin.x,
        y: pointerAction.startPan.y + event.clientY - pointerAction.origin.y,
      });
      return;
    }
    const point = getNormalizedPoint(event);
    if (!point) return;
    const previousPoint = pointerAction.stroke.points.at(-1);
    if (
      previousPoint &&
      Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y) < 0.002
    ) return;
    setPointerAction({
      ...pointerAction,
      stroke: {
        ...pointerAction.stroke,
        points: [...pointerAction.stroke.points, point],
      },
    });
    setCursorPoint(point);
  }

  function finishPointerAction(event: React.PointerEvent, cancelled = false) {
    if (event.pointerType === "touch") {
      activePointersRef.current.delete(event.pointerId);
    }
    if (pointerAction?.kind === "touch-pan") {
      if (pointerAction.pointerIds.includes(event.pointerId)) {
        setPointerAction(null);
      }
      return;
    }
    if (!pointerAction || pointerAction.pointerId !== event.pointerId) return;
    if (!cancelled && pointerAction.kind === "stroke") {
      commitMask({
        ...committedMask,
        strokes: [...committedMask.strokes, pointerAction.stroke],
      });
    }
    setPointerAction(null);
  }

  return (
    <section
      className="card workspace-card"
      aria-labelledby="region-title"
    >
      <div className="workspace-heading">
        <div>
          <h2 id="region-title">{copy.editorTitle}</h2>
          <p>
            {copy.editorHelp}{" "}
            <span className="input-guidance">
              {inputType === "touch"
                ? copy.editorTouch
                : copy.editorDesktop}
            </span>
          </p>
        </div>
      </div>
      <div className="editor-layout">
        <div
          className={`viewer${image ? " has-image" : ""}${
            isFileOver ? " file-over" : ""
          }`}
          aria-label={accessibilityCopy.viewer}
          data-image-aspect={image ? `${image.width}:${image.height}` : undefined}
          style={image
            ? ({ "--image-aspect": image.width / image.height } as React.CSSProperties)
            : undefined}
          onDragEnter={(event) => {
            event.preventDefault();
            setIsFileOver(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) {
              setIsFileOver(false);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            setIsFileOver(false);
            onViewerFiles(event.dataTransfer.files);
          }}
        >
          {isFileOver
            ? <div className="viewer-drop-overlay">{copy.imageDrop}</div>
            : null}
          {image
            ? (
              <div
                className="viewer-pan-area"
                onPointerDown={startPointerAction}
                onPointerMove={movePointerAction}
                onPointerUp={(event) => finishPointerAction(event)}
                onPointerCancel={(event) => finishPointerAction(event, true)}
                onPointerLeave={() => {
                  if (!pointerAction) setCursorPoint(null);
                }}
              >
                <div
                  ref={stageRef}
                  className={`image-stage${
                    pointerAction?.kind === "pan" ||
                      pointerAction?.kind === "touch-pan"
                      ? " is-panning"
                      : ""
                  }`}
                  style={{
                    aspectRatio: `${image.width} / ${image.height}`,
                    transform: `translate(${pan.x}px, ${pan.y}px)`,
                  }}
                >
                  <img
                    src={image.url}
                    alt={recordingCopy.imageAlt}
                    draggable={false}
                  />
                  <canvas
                    ref={overlayRef}
                    className="region-overlay region-weight-overlay"
                    aria-hidden="true"
                  />
                  <svg
                    className="brush-overlay"
                    viewBox={`0 0 ${image.width} ${image.height}`}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    {cursorPoint
                      ? (
                        <circle
                          className="brush-preview"
                          cx={cursorPoint.x * image.width}
                          cy={cursorPoint.y * image.height}
                          r={brushSize * Math.min(image.width, image.height) /
                            2}
                          vectorEffect="non-scaling-stroke"
                        />
                      )
                      : null}
                  </svg>
                </div>
              </div>
            )
            : (
              <div className="viewer-empty">
                <p>{copy.emptyEditor}</p>
              </div>
            )}
        </div>
        <div className="editor-tools" aria-label={accessibilityCopy.editorTools}>
          <div className="segmented-control">
            <button
              type="button"
              aria-pressed={brushMode === "paint"}
              disabled={!image}
              onClick={() => setBrushMode("paint")}
            >
              ＋ {copy.paint}
            </button>
            <button
              type="button"
              aria-pressed={brushMode === "erase"}
              disabled={!image}
              onClick={() => setBrushMode("erase")}
            >
              − {copy.erase}
            </button>
          </div>
          <label className="range-control">
            <span>
              {copy.brushSize}{" "}
              <output>{Math.round(brushSize * 100)}%</output>
            </span>
            <input
              aria-label={copy.brushSize}
              type="range"
              min="1"
              max="20"
              value={Math.round(brushSize * 100)}
              disabled={!image}
              onChange={(event) =>
                setBrushSize(Number(event.target.value) / 100)}
            />
          </label>
          <label className="range-control brush-strength-control">
            <span>
              {copy.brushStrength}{" "}
              <output>{Math.round(brushStrength * 100)}%</output>
            </span>
            <input
              className="brush-strength-input"
              style={{
                "--brush-strength-color": getBrushStrengthColor(brushStrength),
              } as React.CSSProperties}
              aria-label={copy.brushStrength}
              aria-valuetext={`${Math.round(brushStrength * 100)}%`}
              type="range"
              min="0"
              max="100"
              value={Math.round(brushStrength * 100)}
              disabled={!image}
              onChange={(event) =>
                setBrushStrength(Number(event.target.value) / 100)}
            />
          </label>
          <div
            className="thermography-legend"
            aria-label={accessibilityCopy.legend}
          >
            <span><i className="weak" />{copy.weak}</span>
            <span><i className="medium" />{copy.medium}</span>
            <span><i className="strong" />{copy.strong}</span>
          </div>
          <div className="tool-grid">
            <button
              type="button"
              disabled={!image || historyIndex <= 0}
              onClick={undo}
            >
              ↶ {copy.undo}
            </button>
            <button
              type="button"
              disabled={!image || historyIndex >= history.length - 1}
              onClick={redo}
            >
              ↷ {copy.redo}
            </button>
            <button
              type="button"
              disabled={!image}
              onClick={() => commitMask(cloneMask(emptyMask))}
            >
              {copy.resetPaint}
            </button>
            <button
              type="button"
              disabled={!image}
              onClick={() =>
                commitMask({ baseFill: 1, inverted: false, strokes: [] })}
            >
              {copy.paintAll}
            </button>
            <button
              type="button"
              disabled={!image}
              onClick={() =>
                commitMask({
                  ...committedMask,
                  inverted: !committedMask.inverted,
                })}
            >
              {copy.invert}
            </button>
          </div>
          {image && coverage > 0 && coverage < 0.05
            ? (
              <p className="quality-warning" role="status">
                ! {copy.qualityWarning}
              </p>
            )
            : null}
        </div>
      </div>
    </section>
  );
}
