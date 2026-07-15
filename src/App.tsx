import { useCallback, useEffect, useRef, useState } from "react";
import mPlusRoundedLicenseUrl from "@fontsource/m-plus-rounded-1c/LICENSE?url";
import notoSansThaiLicenseUrl from "@fontsource/noto-sans-thai/LICENSE?url";
import { ImageInput } from "./components/ImageInput";
import { LanguageMenu } from "./components/LanguageMenu";
import { MaskEditor } from "./components/MaskEditor";
import { ModeNavigation } from "./components/ModeNavigation";
import { Recorder } from "./components/Recorder";
import { WobbleCanvas } from "./components/WobbleCanvas";
import { WobbleControls } from "./components/WobbleControls";
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
  const surfaceRef = useRef<WobbleSurfaceHandle>(null);
  const imageRef = useRef<LoadedImage | null>(null);

  imageRef.current = image;

  useEffect(() => () => disposeLoadedImage(imageRef.current), []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!image || isLocked || event.isComposing) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, select, textarea, button")) return;
      if (event.key === "1") setMode("region-edit");
      if (event.key === "2") setMode("play");
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [image, isLocked]);

  async function handleFiles(files: FileList) {
    if (isLocked) return;
    try {
      const nextImage = await loadImage(files);
      const hasPaint = mask.baseFill !== 0 || mask.inverted ||
        mask.strokes.length > 0;
      if (image && hasPaint && !window.confirm(copy.replaceConfirm)) {
        disposeLoadedImage(nextImage);
        return;
      }
      disposeLoadedImage(image);
      setImage(nextImage);
      setMask(cloneEmptyMask());
      setMode("region-edit");
      setSensorTarget({ x: 0, y: 0 });
      setImageError(null);
    } catch (caughtError) {
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
        <LanguageMenu />
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
          onMode={setMode}
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
              )
              : null}
          </aside>

          <div
            className="region-column"
            hidden={mode === "play" && Boolean(image)}
          >
            <MaskEditor
              key={image?.url ?? "empty"}
              image={image}
              onViewerFiles={(files) => void handleFiles(files)}
              onMaskChange={setMask}
            />
          </div>

          {image
            ? (
              <div className="play-column" hidden={mode !== "play"}>
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
                <Recorder
                  image={image}
                  mask={mask}
                  surfaceRef={surfaceRef}
                  onLockedChange={handleLockedChange}
                />
              </div>
            )
            : null}
        </div>
        <ModeNavigation
          bottom
          mode={mode}
          disabled={!image || isLocked}
          onMode={setMode}
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
