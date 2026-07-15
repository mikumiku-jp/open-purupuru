import {
  Activity,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import mPlusRoundedLicenseUrl from "@fontsource/m-plus-rounded-1c/LICENSE?url";
import notoSansThaiLicenseUrl from "@fontsource/noto-sans-thai/LICENSE?url";
import { ImageInput } from "./components/ImageInput";
import { LanguageMenu } from "./components/LanguageMenu";
import { MaskEditor } from "./components/MaskEditor";
import { ModeNavigation } from "./components/ModeNavigation";
import { disposeLoadedImage, ImageLoadError, loadImage } from "./image-loader";
import type { ImageErrorCode } from "./image-loader";
import { appTitle, useI18n } from "./i18n";
import { accessibilityLocales } from "./accessibility-locales";
import { closeErrorLocales } from "./error-locales";
import { emptyMask } from "./mask";
import { presets } from "./presets";
import type {
  AppMode,
  AutoMotion,
  LoadedImage,
  MaskState,
  Point,
  PresetId,
  WobbleParameters,
  WobbleSurfaceHandle,
} from "./types";

const Recorder = lazy(async () => {
  const recorderModule = await import("./components/Recorder");
  return { default: recorderModule.Recorder };
});
const WobbleCanvas = lazy(async () => {
  const canvasModule = await import("./components/WobbleCanvas");
  return { default: canvasModule.WobbleCanvas };
});
const WobbleControls = lazy(async () => {
  const controlsModule = await import("./components/WobbleControls");
  return { default: controlsModule.WobbleControls };
});

const imageErrorKeys: Record<
  ImageErrorCode,
  keyof ReturnType<typeof useI18n>["copy"]
> = {
  multiple: "fileErrorMultiple",
  type: "fileErrorType",
  fileSize: "fileErrorSize",
  animated: "fileErrorAnimated",
  decode: "fileErrorDecode",
  dimensions: "fileErrorDimensions",
};

function cloneEmptyMask(): MaskState {
  return {
    baseFill: emptyMask.baseFill,
    inverted: emptyMask.inverted,
    strokes: [],
  };
}

export function App() {
  const { copy, language } = useI18n();
  const accessibilityCopy = accessibilityLocales[language];
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [mask, setMask] = useState<MaskState>(cloneEmptyMask);
  const [mode, setMode] = useState<AppMode>("region-edit");
  const [selectedPreset, setSelectedPreset] = useState<PresetId>("purupuru");
  const [parameters, setParameters] = useState<WobbleParameters>({
    ...presets.purupuru,
  });
  const [autoMotion, setAutoMotion] = useState<AutoMotion>(null);
  const [autoStrength, setAutoStrength] = useState(50);
  const [autoPeriodMs, setAutoPeriodMs] = useState(1000);
  const [sensorTarget, setSensorTarget] = useState<Point>({ x: 0, y: 0 });
  const [imageError, setImageError] = useState<ImageErrorCode | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [hasEnteredPlayMode, setHasEnteredPlayMode] = useState(false);
  const surfaceRef = useRef<WobbleSurfaceHandle>(null);
  const imageRef = useRef<LoadedImage | null>(null);
  const maskRef = useRef(mask);
  const latestImageRequestRef = useRef(0);
  const changeMode = useCallback((nextMode: AppMode) => {
    if (nextMode === "play") setHasEnteredPlayMode(true);
    setMode(nextMode);
  }, []);

  imageRef.current = image;
  maskRef.current = mask;

  useEffect(() => () => {
    latestImageRequestRef.current += 1;
    disposeLoadedImage(imageRef.current);
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!image || isLocked || event.isComposing) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, select, textarea, button")) return;
      if (event.key === "1") changeMode("region-edit");
      if (event.key === "2") changeMode("play");
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [changeMode, image, isLocked]);

  async function handleFiles(files: FileList) {
    if (isLocked) return;
    const requestId = latestImageRequestRef.current + 1;
    latestImageRequestRef.current = requestId;
    try {
      const nextImage = await loadImage(files);
      if (requestId !== latestImageRequestRef.current) {
        disposeLoadedImage(nextImage);
        return;
      }
      const currentImage = imageRef.current;
      const currentMask = maskRef.current;
      const hasPaint = currentMask.baseFill !== 0 || currentMask.inverted ||
        currentMask.strokes.length > 0;
      if (currentImage && hasPaint && !window.confirm(copy.replaceConfirm)) {
        disposeLoadedImage(nextImage);
        return;
      }
      disposeLoadedImage(currentImage);
      imageRef.current = nextImage;
      setImage(nextImage);
      const nextMask = cloneEmptyMask();
      maskRef.current = nextMask;
      setMask(nextMask);
      setMode("region-edit");
      setSensorTarget({ x: 0, y: 0 });
      setImageError(null);
    } catch (caughtError) {
      if (requestId !== latestImageRequestRef.current) return;
      setImageError(
        caughtError instanceof ImageLoadError ? caughtError.code : "decode",
      );
    }
  }

  function selectPreset(presetId: PresetId) {
    setSelectedPreset(presetId);
    setParameters({ ...presets[presetId] });
  }

  const handleSensorTarget = useCallback(
    (target: Point) => setSensorTarget(target),
    [],
  );
  const handleLockedChange = useCallback(
    (locked: boolean) => setIsLocked(locked),
    [],
  );
  const errorMessage = imageError ? copy[imageErrorKeys[imageError]] : null;

  return (
    <div className="app-shell">
      <header className="app-header">
        <section className="app-hero">
          <h1>
            <span className="title-effect" aria-hidden="true">{appTitle}</span>
            <span className="sr-only">{appTitle}</span>
          </h1>
          <p>{copy.tagline}</p>
        </section>
        <div className="header-actions">
          <a
            className="github-link"
            href="https://github.com/mikumiku-jp/open-purupuru"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub repository"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.63 1.22 3.27.93.1-.73.39-1.22.71-1.5-2.5-.28-5.13-1.25-5.13-5.56 0-1.23.44-2.23 1.16-3.02-.12-.28-.5-1.43.11-2.98 0 0 .95-.3 3.09 1.15a10.75 10.75 0 0 1 5.63 0c2.14-1.45 3.08-1.15 3.08-1.15.62 1.55.23 2.7.12 2.98.72.79 1.16 1.79 1.16 3.02 0 4.32-2.64 5.27-5.15 5.55.41.35.77 1.04.77 2.1v3.14c0 .3.2.65.78.54A11.25 11.25 0 0 0 12 .75Z"
              />
            </svg>
          </a>
          <LanguageMenu />
        </div>
      </header>

      {errorMessage
        ? (
          <div className="error-toast" id="image-error-toast" role="alert">
            <span aria-hidden="true">!</span>
            <p>{errorMessage}</p>
            <button
              type="button"
              aria-label={closeErrorLocales[language]}
              onClick={() => setImageError(null)}
            >
              ×
            </button>
          </div>
        )
        : null}

      <main id="main">
        <ModeNavigation
          mode={mode}
          disabled={!image || isLocked}
          onMode={changeMode}
          showGuidance={Boolean(image)}
        />
        <div
          className={`app-grid ${
            mode === "play" ? "is-play-mode" : "is-edit-mode"
          }`}
        >
          <aside className="settings-column">
            <ImageInput
              image={image}
              disabled={isLocked}
              onFiles={(files) => void handleFiles(files)}
            />
            {mode === "play" && image
              ? (
                <Suspense fallback={null}>
                  <WobbleControls
                    disabled={isLocked}
                    selectedPreset={selectedPreset}
                    parameters={parameters}
                    autoMotion={autoMotion}
                    autoStrength={autoStrength}
                    autoPeriodMs={autoPeriodMs}
                    onPreset={selectPreset}
                    onParameters={setParameters}
                    onAutoMotion={setAutoMotion}
                    onAutoStrength={setAutoStrength}
                    onAutoPeriodMs={setAutoPeriodMs}
                    onSensorTarget={handleSensorTarget}
                  />
                </Suspense>
              )
              : null}
          </aside>

          <Activity mode={mode === "play" && image ? "hidden" : "visible"}>
            <div className="region-column">
              <MaskEditor
                key={image?.url ?? "empty"}
                image={image}
                onViewerFiles={(files) => void handleFiles(files)}
                onMaskChange={setMask}
              />
            </div>
          </Activity>

          {image
            ? (
              <div className="play-column" hidden={mode !== "play"}>
                <Suspense
                  fallback={
                    <div className="card workspace-card play-card" aria-hidden="true" />
                  }
                >
                  {mode === "play"
                    ? (
                      <section
                        className="card workspace-card play-card"
                        aria-labelledby="play-title"
                      >
                        <div className="section-heading play-heading">
                          <h2 id="play-title">{copy.wobbleTitle}</h2>
                          <p>
                            {matchMedia("(pointer: coarse)").matches
                              ? copy.wobbleTouch
                              : copy.wobbleDesktop}
                          </p>
                        </div>
                        <WobbleCanvas
                          ref={surfaceRef}
                          image={image}
                          mask={mask}
                          parameters={parameters}
                          autoMotion={autoMotion}
                          autoStrength={autoStrength}
                          autoPeriodMs={autoPeriodMs}
                          sensorTarget={sensorTarget}
                          language={language}
                        />
                      </section>
                    )
                    : null}
                  {hasEnteredPlayMode
                    ? (
                      <Recorder
                        image={image}
                        mask={mask}
                        surfaceRef={surfaceRef}
                        onLockedChange={handleLockedChange}
                      />
                    )
                    : null}
                </Suspense>
              </div>
            )
            : null}
        </div>
        <ModeNavigation
          bottom
          mode={mode}
          disabled={!image || isLocked}
          onMode={changeMode}
        />
      </main>

      <footer className="app-footer" aria-labelledby="footer-title">
        <h2 className="sr-only" id="footer-title">{copy.footerTitle}</h2>
        <div className="footer-notices">
          <p>{copy.footerLocal}</p>
          <p>{copy.footerRights}</p>
          <p>{copy.footerCommercial}</p>
          <p>{copy.footerDisclaimer}</p>
        </div>
        <div className="footer-meta">
          <span>
            {accessibilityCopy.fontLicenses}
          </span>
          <span className="footer-meta-separator" aria-hidden="true">/</span>
          <a href={mPlusRoundedLicenseUrl}>
            M PLUS Rounded 1c
          </a>
          <span className="footer-meta-separator" aria-hidden="true">/</span>
          <a href={notoSansThaiLicenseUrl}>
            Noto Sans Thai
          </a>
        </div>
      </footer>
    </div>
  );
}
