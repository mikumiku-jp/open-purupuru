import { useI18n } from "../i18n";
import { accessibilityLocales } from "../accessibility-locales";
import type { AppMode } from "../types";

type Props = {
  mode: AppMode;
  disabled: boolean;
  onMode: (mode: AppMode) => void;
  bottom?: boolean;
  showGuidance?: boolean;
};

export function ModeNavigation(
  { mode, disabled, onMode, bottom = false, showGuidance = false }: Props,
) {
  const { copy, language } = useI18n();
  const accessibilityCopy = accessibilityLocales[language];
  return (
    <div
      className={`mode-navigation ${
        bottom ? "bottom-mode-navigation" : "top-mode-navigation"
      }`}
    >
      <nav
        className="mode-tabs"
        aria-label={bottom
          ? accessibilityCopy.bottomMode
          : accessibilityCopy.topMode}
      >
        <button
          type="button"
          aria-keyshortcuts={bottom ? undefined : "1"}
          aria-label={bottom ? accessibilityCopy.bottomEdit : undefined}
          aria-current={mode === "region-edit" ? "step" : undefined}
          disabled={disabled}
          onClick={() => onMode("region-edit")}
        >
          {copy.edit}
        </button>
        <button
          type="button"
          aria-keyshortcuts={bottom ? undefined : "2"}
          aria-label={bottom ? accessibilityCopy.bottomPlay : undefined}
          aria-current={mode === "play" ? "step" : undefined}
          disabled={disabled}
          onClick={() => onMode("play")}
        >
          {copy.play}
        </button>
      </nav>
      {showGuidance
        ? (
          <div className="mode-guidance" aria-live="polite">
            {mode === "play"
              ? (
                <>
                  <span className="mode-hint">{copy.editHint}</span>
                  <span aria-hidden="true" />
                </>
              )
              : (
                <>
                  <span aria-hidden="true" />
                  <span className="mode-hint">{copy.playHint}</span>
                </>
              )}
          </div>
        )
        : null}
    </div>
  );
}
