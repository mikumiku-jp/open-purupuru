import { useEffect, useMemo, useRef, useState } from "react";
import { exportMedia, inspectExportCapabilities } from "../exporter";
import type { ExportCapabilities } from "../exporter";
import { useI18n } from "../i18n";
import { recordingLocales } from "../recording-locales";
import type { PhysicsInputEvent, PhysicsSnapshot } from "../physics";
import type {
  ExportFormat,
  ExportResult,
  LoadedImage,
  MaskState,
  RecordingView,
  WobbleSurfaceHandle,
} from "../types";

type Props = {
  image: LoadedImage;
  mask: MaskState;
  surfaceRef: React.RefObject<WobbleSurfaceHandle | null>;
  onLockedChange: (isLocked: boolean) => void;
};

type RecorderState = "idle" | "countdown" | "recording" | "encoding";

const initialCapabilities: ExportCapabilities = {
  mp4: { supported: false },
  webm: { supported: false },
  gif: { supported: true },
};

function sanitizeFileName(
  fileName: string,
  language: string,
  extension: string,
) {
  const baseName = fileName.replace(/\.[^.]*$/, "").trim() || "purupuru";
  const safeName = baseName.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
  return `${safeName}_${
    language === "ja" ? "プルプル" : "purupuru"
  }.${extension}`;
}

export function Recorder({ image, mask, surfaceRef, onLockedChange }: Props) {
  const { copy, language } = useI18n();
  const recordingCopy = recordingLocales[language];
  const [state, setState] = useState<RecorderState>("idle");
  const [format, setFormat] = useState<ExportFormat>("gif");
  const [durationSeconds, setDurationSeconds] = useState(5);
  const [recordingView, setRecordingView] = useState<RecordingView>("original");
  const [capabilities, setCapabilities] = useState<ExportCapabilities>(
    initialCapabilities,
  );
  const [isChecking, setIsChecking] = useState(true);
  const [countdown, setCountdown] = useState(3);
  const [recordedSeconds, setRecordedSeconds] = useState(0);
  const [progress, setProgress] = useState(0);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopRequestedRef = useRef(false);
  const isFinishingRef = useRef(false);
  const countdownTimerRef = useRef<number | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef(0);
  const initialSnapshotRef = useRef<PhysicsSnapshot | null>(null);
  const exportResultUrlRef = useRef<string | null>(null);
  const maximumDuration = format === "gif" ? 5 : 10;
  const isBusy = state !== "idle";
  const fileName = exportResult
    ? sanitizeFileName(image.sourceName, language, exportResult.format)
    : "";
  const shareFile = useMemo(
    () =>
      exportResult
        ? new File([exportResult.blob], fileName, {
          type: exportResult.blob.type,
        })
        : null,
    [exportResult, fileName],
  );
  const canShare = Boolean(
    shareFile && navigator.canShare?.({ files: [shareFile] }),
  );

  useEffect(() => {
    let isCancelled = false;
    void inspectExportCapabilities().then((nextCapabilities) => {
      if (isCancelled) return;
      setCapabilities(nextCapabilities);
      const defaultFormat: ExportFormat = nextCapabilities.mp4.supported
        ? "mp4"
        : nextCapabilities.webm.supported
        ? "webm"
        : "gif";
      setFormat(defaultFormat);
      setIsChecking(false);
    });
    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    onLockedChange(isBusy);
    return () => onLockedChange(false);
  }, [isBusy, onLockedChange]);

  useEffect(() => () => {
    if (countdownTimerRef.current !== null) {
      window.clearInterval(countdownTimerRef.current);
    }
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
    }
    if (exportResultUrlRef.current) {
      URL.revokeObjectURL(exportResultUrlRef.current);
    }
  }, []);

  function clearExportResult() {
    setExportResult((current) => {
      if (current) URL.revokeObjectURL(current.url);
      exportResultUrlRef.current = null;
      return null;
    });
  }

  function beginRecording() {
    if (isBusy || isChecking || !capabilities[format].supported) return;
    clearExportResult();
    setError(null);
    setProgress(0);
    setCountdown(3);
    setRecordedSeconds(0);
    stopRequestedRef.current = false;
    setState("countdown");
    const countdownStartedAt = performance.now();
    countdownTimerRef.current = window.setInterval(() => {
      const remaining = Math.max(
        0,
        3 - Math.floor((performance.now() - countdownStartedAt) / 1000),
      );
      setCountdown(remaining);
      if (remaining > 0) return;
      if (countdownTimerRef.current !== null) {
        window.clearInterval(countdownTimerRef.current);
      }
      countdownTimerRef.current = null;
      startLiveCapture();
    }, 200);
  }

  function startLiveCapture() {
    const surface = surfaceRef.current;
    if (!surface) {
      setError(copy.exportFailed);
      setState("idle");
      return;
    }
    try {
      initialSnapshotRef.current = surface.startCapture();
    } catch {
      setError(copy.exportFailed);
      setState("idle");
      return;
    }
    recordingStartedAtRef.current = performance.now();
    isFinishingRef.current = false;
    setState("recording");
    recordingTimerRef.current = window.setInterval(() => {
      const elapsedSeconds = Math.max(
        0,
        (performance.now() - recordingStartedAtRef.current) / 1000,
      );
      setRecordedSeconds(elapsedSeconds);
      if (elapsedSeconds >= durationSeconds) {
        void finishLiveCapture();
      }
    }, 100);
  }

  async function finishLiveCapture() {
    if (isFinishingRef.current) return;
    isFinishingRef.current = true;
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    const surface = surfaceRef.current;
    const initialSnapshot = initialSnapshotRef.current;
    if (!surface || !initialSnapshot) {
      setError(copy.exportFailed);
      setState("idle");
      isFinishingRef.current = false;
      return;
    }
    const events = surface.stopCapture();
    const elapsedSeconds = Math.max(
      0.1,
      Math.min(
        durationSeconds,
        (performance.now() - recordingStartedAtRef.current) / 1000,
      ),
    );
    initialSnapshotRef.current = null;
    setState("encoding");
    await runExport(initialSnapshot, events, elapsedSeconds);
  }

  async function runExport(
    initialSnapshot: PhysicsSnapshot,
    events: PhysicsInputEvent[],
    capturedDurationSeconds: number,
  ) {
    stopRequestedRef.current = false;
    try {
      const exportedMedia = await exportMedia({
        image,
        mask,
        initialSnapshot,
        events,
        format,
        durationSeconds: capturedDurationSeconds,
        recordingView,
        shouldStop: () => stopRequestedRef.current,
        onProgress: ({ ratio }) => {
          setProgress(ratio);
        },
      });
      const url = URL.createObjectURL(exportedMedia.blob);
      exportResultUrlRef.current = url;
      setExportResult({
        blob: exportedMedia.blob,
        url,
        format,
        width: exportedMedia.width,
        height: exportedMedia.height,
        durationSeconds: exportedMedia.durationSeconds,
      });
    } catch {
      setError(copy.exportFailed);
    } finally {
      setState("idle");
      isFinishingRef.current = false;
      stopRequestedRef.current = false;
      setProgress(0);
    }
  }

  function stopRecording() {
    if (state === "countdown") {
      if (countdownTimerRef.current !== null) {
        window.clearInterval(countdownTimerRef.current);
      }
      countdownTimerRef.current = null;
      setState("idle");
      return;
    }
    if (state === "recording") {
      void finishLiveCapture();
      return;
    }
    if (state === "encoding") stopRequestedRef.current = true;
  }

  async function shareResult() {
    if (!shareFile) return;
    try {
      await navigator.share({ files: [shareFile], title: fileName });
    } catch (caughtError) {
      if (
        caughtError instanceof DOMException && caughtError.name === "AbortError"
      ) return;
      setError(copy.exportFailed);
    }
  }

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.matches("input, select, textarea, button")
      ) return;
      if (event.isComposing) return;
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        if (state === "recording") void finishLiveCapture();
        else if (state === "idle") beginRecording();
      }
      if (event.key === "Escape") {
        if (state === "countdown") stopRecording();
        if (state === "recording") void finishLiveCapture();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  const viewHelp = recordingView === "original"
    ? copy.viewOriginalHelp
    : recordingView === "crop"
    ? copy.viewCropHelp
    : copy.viewFollowHelp;

  return (
    <section className="card recording-panel" aria-labelledby="recording-title">
      <div className="section-heading">
        <h2 id="recording-title">{copy.recorderTitle}</h2>
        <p>{copy.recorderHelp}</p>
      </div>
      <div className="recording-action">
        {state === "countdown"
          ? (
            <p className="record-status" role="status">
              {copy.countdown}: {countdown}
            </p>
          )
          : null}
        {state === "recording"
          ? (
            <p className="record-status recording" role="status">
              ● {copy.recording} {recordedSeconds.toFixed(1)}s
            </p>
          )
          : null}
        {state === "encoding"
          ? (
            <div className="encode-progress" aria-live="polite">
              <label>
                {copy.encoding} {Math.round(progress * 100)}%
                <progress value={progress} max="1" />
              </label>
              <button type="button" onClick={stopRecording}>{copy.cancel}</button>
            </div>
          )
          : null}
        {error
          ? <p className="error-message" role="alert">! {error}</p>
          : null}
        {state === "idle"
          ? (
            <div className="record-start-area">
              <button
                className="record-button"
                type="button"
                disabled={!capabilities[format].supported || isChecking}
                onClick={beginRecording}
              >
                {copy.record}
              </button>
            </div>
          )
          : null}
        {state === "recording"
          ? (
            <button
              className="record-button stop"
              type="button"
              onClick={() => void finishLiveCapture()}
            >
              {copy.stop}
            </button>
          )
          : null}
      </div>
      <div className="recording-settings">
        <label>
          {copy.format}
          <select
            value={format}
            disabled={isBusy}
            onChange={(event) => {
              const nextFormat = event.target.value as ExportFormat;
              setFormat(nextFormat);
              if (nextFormat === "gif") {
                setDurationSeconds((current) =>
                  Math.min(5, current)
                );
              }
            }}
          >
            {(["mp4", "webm", "gif"] as ExportFormat[]).map((candidate) => (
              <option
                key={candidate}
                value={candidate}
                disabled={!capabilities[candidate].supported}
              >
                {candidate.toUpperCase()}（{recordingCopy.maximumLabel(
                  candidate === "gif" ? 5 : 10,
                )}）
                {!capabilities[candidate].supported
                  ? ` — ${capabilities[candidate].reason ?? copy.unsupported}`
                  : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          {copy.duration}
          <select
            value={durationSeconds}
            disabled={isBusy}
            onChange={(event) => setDurationSeconds(Number(event.target.value))}
          >
            {Array.from({ length: maximumDuration }, (_, index) => index + 1)
              .map((seconds) => (
                <option key={seconds} value={seconds}>
                  {recordingCopy.durationLabel(seconds)}
                </option>
              ))}
          </select>
        </label>
        <fieldset className="recording-view" disabled={isBusy}>
          <legend>{copy.recordingView}</legend>
          <div className="recording-view-options">
            {([
              ["original", copy.viewOriginal],
              ["crop", copy.viewCrop],
              ["camera-follow", copy.viewFollow],
            ] as Array<[RecordingView, string]>).map(([value, label]) => (
              <label key={value} className="recording-view-option">
                <input
                  type="radio"
                  name="recording-view"
                  value={value}
                  checked={recordingView === value}
                  aria-describedby="recording-view-help"
                  onChange={() =>
                    setRecordingView(value)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <p id="recording-view-help">{viewHelp}</p>
        </fieldset>
      </div>
      {exportResult
        ? (
          <div className="result-player">
            {exportResult.format === "gif"
              ? <img src={exportResult.url} alt="GIF preview" />
              : <video src={exportResult.url} controls playsInline />}
            <p>
              {exportResult.format.toUpperCase()} ·{" "}
              {exportResult.width} × {exportResult.height} ·{" "}
              {exportResult.format === "gif" ? 16 : 30}fps ·{" "}
              {(exportResult.blob.size / 1024 / 1024).toFixed(2)} MiB
            </p>
            <div className="result-actions">
              <a
                className="save-link"
                href={exportResult.url}
                download={fileName}
              >
                {copy.save}
              </a>
              {canShare
                ? (
                  <button
                    className="secondary-button mobile-share-button"
                    type="button"
                    onClick={() => void shareResult()}
                  >
                    {copy.share}
                  </button>
                )
                : null}
            </div>
          </div>
        )
        : null}
    </section>
  );
}
