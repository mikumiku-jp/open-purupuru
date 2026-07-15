import { useEffect, useRef, useState } from "react";
import { languageNames, useI18n } from "../i18n";
import { languageIconMarkup } from "../language-icon-markup";
import type { Language } from "../types";

const europe: Language[] = ["en", "de", "fr", "es", "it", "pt", "ru", "uk"];
const asia: Language[] = ["ko", "th", "id", "vi", "zh-CN", "zh-TW", "zh-HK"];
function GlobeIcon() {
  return (
    <svg
      className="language-globe"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      data-icon="language-globe"
    >
      <circle cx="12" cy="12" r="9.25" />
      <path d="M2.9 12h18.2M12 2.75c2.45 2.5 3.75 5.6 3.75 9.25S14.45 18.75 12 21.25C9.55 18.75 8.25 15.65 8.25 12S9.55 5.25 12 2.75Z" />
    </svg>
  );
}

function FoodIcon({ language }: { language: Language }) {
  const icon = languageIconMarkup[language];
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className="language-food"
      data-food={icon.food}
      dangerouslySetInnerHTML={{ __html: icon.inner }}
    />
  );
}

export function LanguageMenu() {
  const { language, setLanguage, copy } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const orderedLanguages: Language[] = ["ja", ...europe, ...asia];

  useEffect(() => {
    if (!isOpen) return;
    const closeMenu = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener("pointerdown", closeMenu);
    return () => document.removeEventListener("pointerdown", closeMenu);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    queueMicrotask(() => buttonRefs.current[orderedLanguages.indexOf(language)]?.focus());
  }, [isOpen, language]);

  function selectLanguage(nextLanguage: Language) {
    setLanguage(nextLanguage);
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  function handleMenuKeyDown(event: React.KeyboardEvent) {
    const currentIndex = buttonRefs.current.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | undefined;
    if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % orderedLanguages.length;
    if (event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + orderedLanguages.length) % orderedLanguages.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = orderedLanguages.length - 1;
    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (nextIndex === undefined) return;
    event.preventDefault();
    buttonRefs.current[nextIndex]?.focus();
  }

  const renderLanguage = (candidate: Language) => {
    const languageIndex = orderedLanguages.indexOf(candidate);
    return (
      <button
        ref={(button) => {
          buttonRefs.current[languageIndex] = button;
        }}
        key={candidate}
        type="button"
        role="menuitemradio"
        aria-checked={language === candidate}
        onClick={() => selectLanguage(candidate)}
      >
        <FoodIcon language={candidate} />
        <span>{languageNames[candidate]}</span>
        <span className="language-check" aria-hidden="true">
          {language === candidate ? "✓" : ""}
        </span>
      </button>
    );
  };

  return (
    <div className="language-switch" ref={containerRef}>
      <button
        ref={triggerRef}
        className="language-trigger"
        type="button"
        aria-label={`${copy.language}: ${languageNames[language]}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls="language-menu"
        onClick={() => setIsOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          setIsOpen(true);
        }}
      >
        <GlobeIcon />
        <span className="language-current">
          <FoodIcon language={language} />
          <span>{languageNames[language]}</span>
          <span className="language-chevron" aria-hidden="true">⌄</span>
        </span>
      </button>
      {isOpen
        ? (
          <div
            id="language-menu"
            className="language-menu"
            role="menu"
            aria-label={copy.language}
            onKeyDown={handleMenuKeyDown}
          >
            {renderLanguage("ja")}
            <div className="language-menu-heading" role="presentation">Europe / 欧州</div>
            {europe.map(renderLanguage)}
            <div className="language-menu-heading" role="presentation">Asia / アジア</div>
            {asia.map(renderLanguage)}
          </div>
        )
        : null}
    </div>
  );
}
