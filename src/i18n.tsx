import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { languages } from "./types";
import type { Language } from "./types";

export const appTitle = "おーぷんぷるぷるメーカー";

export const languageNames: Record<Language, string> = {
  ja: "日本語",
  en: "English",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
  it: "Italiano",
  pt: "Português",
  ru: "Русский",
  uk: "Українська",
  ko: "한국어",
  th: "ไทย",
  id: "Bahasa Indonesia",
  vi: "Tiếng Việt",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文（台灣）",
  "zh-HK": "繁體中文（香港）",
};

const japanese = {
  appTitle: "おーぷんぷるぷるメーカー",
  tagline: "揺らしたい場所を塗って、画像をぷるぷる動かそう！",
  language: "言語",
  edit: "塗る",
  play: "揺らす",
  playHint: "塗った場所を揺らせます",
  editHint: "揺らす場所を塗れます",
  imageTitle: "画像を読む",
  imageHelp: "画像を1枚読み込みます。",
  imageDrop: "画像をここにドロップ",
  imageDropHint: "PNG・JPEG・WebP",
  selectFile: "ファイルを選ぶ",
  replaceImage: "画像を入れ替える",
  replaceConfirm: "ぷるぷる範囲を消して画像を入れ替えますか？",
  dimensions: "寸法",
  format: "形式",
  optimized: "作業用に縮小",
  editorTitle: "揺らす範囲を塗る",
  editorHelp: "色と模様が付いたところが揺れます。",
  editorDesktop: "左クリックで塗る・ホイールクリックで移動",
  editorTouch: "1本指で塗る・2本指で移動",
  emptyEditor: "画像を読み込むと、ここで範囲を塗れます。",
  paint: "塗る",
  erase: "消す",
  brushSize: "ブラシ太さ",
  brushStrength: "ブラシ強度",
  weak: "弱",
  medium: "中",
  strong: "強",
  undo: "元に戻す",
  redo: "やり直す",
  resetPaint: "塗りリセット",
  paintAll: "全体を塗る",
  invert: "塗り範囲を反転",
  qualityWarning:
    "この範囲は小さいため、動きが角ばる場合があります。少し広く塗ると滑らかになります。",
  wobbleTitle: "揺らす",
  wobbleDesktop: "画像をクリックしたままマウスを動かしてください。",
  wobbleTouch: "画像をタップしたまま動かしてください。",
  wobbleSettings: "揺れ設定",
  wobbleSettingsHelp: "揺らし方を変えられます。",
  details: "細かく調整",
  resetPreset: "このプリセットに戻す",
  stretch: "のび",
  damping: "おさまり",
  cohesion: "まとまり",
  variation: "ゆらぎ",
  gravityDirection: "重力の向き",
  gravityStrength: "重力の強さ",
  gravityNone: "なし",
  gravityDown: "下",
  gravityUp: "上",
  gravityLeft: "左",
  gravityRight: "右",
  autoMotion: "自動で揺らす",
  autoHelp: "塗った場所を自動で揺らします",
  sway: "横ゆらゆら",
  hop: "縦ぴょんぴょん",
  orbit: "円ぐるぐる",
  autoStrength: "自動揺れの強さ",
  autoPeriod: "自動揺れの周期",
  sensorEnable: "動作センサーを有効にする",
  sensorDisable: "センサーを止める",
  recorderTitle: "録画して保存",
  recorderHelp: "画像を揺らした動きを録画します（3秒後録画開始）",
  record: "録画を開始",
  stop: "録画を停止",
  countdown: "録画まで",
  recording: "録画中",
  encoding: "動画を作成中",
  cancel: "キャンセル",
  duration: "録画時間",
  seconds: "秒",
  recordingView: "録画の見え方",
  viewOriginal: "そのまま (おすすめ)",
  viewCrop: "画面端をクロップ",
  viewFollow: "カメラ追従",
  viewOriginalHelp: "画像全体の動きもそのまま録画します。おすすめの設定です。",
  viewCropHelp: "画像全体の動きを残したまま拡大し、端の露出を防ぎます。",
  viewFollowHelp: "録画の中心を画像の中心に追従させ、端の露出を防ぎます。",
  save: "保存",
  share: "写真アプリへ保存",
  exportFailed: "書き出しに失敗しました。別の形式でもう一度お試しください。",
  unsupported: "このブラウザでは利用できません",
  footerTitle: "利用条件とデータの取り扱い",
  footerLocal:
    "画像・範囲データ・録画結果はブラウザ内だけで処理し、サーバーへ送信も保存もしません。言語設定以外は永続保存しません。",
  footerRights:
    "第三者の権利を侵害する画像や素材は使用しないでください。入力素材の権利、適用法令、第三者サービスの規約は利用者の責任でご確認ください。",
  footerCommercial:
    "本アプリで作成した生成物は商用利用できます。ただし、入力素材そのものの権利を新たに許諾するものではありません。",
  footerDisclaimer:
    "本アプリの利用によって生じた損害について、開発者は法令で認められる範囲で責任を負いません。大切なデータは利用前にバックアップしてください。",
  fileErrorMultiple: "画像は1枚だけ選んでください。",
  fileErrorType: "PNG、JPEG、WebPの静止画像を選んでください。",
  fileErrorSize: "ファイルが大きすぎます。80MB以下の画像を選んでください。",
  fileErrorAnimated:
    "アニメーション画像には対応していません。静止画像を選んでください。",
  fileErrorDecode:
    "画像を読み込めませんでした。ファイルが壊れていないか確認してください。",
  fileErrorDimensions:
    "この画像を端末内で安全に縮小できませんでした。別の画像を選ぶか、画像を小さくしてから再試行してください。",
};

export type Translation = typeof japanese;

const english: Translation = {
  appTitle: "Open Purupuru Maker",
  tagline: "Paint where you want it to wobble, then make the image jiggle!",
  language: "Language",
  edit: "Paint",
  play: "Wobble",
  playHint: "Wobble the areas you painted",
  editHint: "Paint where the image should wobble",
  imageTitle: "Load an image",
  imageHelp: "Load one image to get started.",
  imageDrop: "Drop an image here",
  imageDropHint: "PNG, JPEG, or WebP",
  selectFile: "Choose a file",
  replaceImage: "Replace image",
  replaceConfirm: "Replace the image and clear the current wobble area?",
  dimensions: "Dimensions",
  format: "Format",
  optimized: "Downscaled for editing",
  editorTitle: "Paint the wobble area",
  editorHelp: "Areas marked with color and a pattern will wobble.",
  editorDesktop: "Left-click to paint · Middle-click to move",
  editorTouch: "Paint with one finger · Move with two fingers",
  emptyEditor: "Add an image first, then paint its wobble area here.",
  paint: "Paint",
  erase: "Erase",
  brushSize: "Brush size",
  brushStrength: "Brush strength",
  weak: "Weak",
  medium: "Medium",
  strong: "Strong",
  undo: "Undo",
  redo: "Redo",
  resetPaint: "Reset paint",
  paintAll: "Paint all",
  invert: "Invert painted area",
  qualityWarning:
    "This area is small and may look angular. Paint it a little wider for smoother motion.",
  wobbleTitle: "Wobble",
  wobbleDesktop: "Hold the mouse button down on the image and move it.",
  wobbleTouch: "Keep one finger pressed on the image and move it.",
  wobbleSettings: "Wobble settings",
  wobbleSettingsHelp: "Change how the image wobbles.",
  details: "Fine tuning",
  resetPreset: "Reset to this preset",
  stretch: "Stretch",
  damping: "Settle",
  cohesion: "Cohesion",
  variation: "Variation",
  gravityDirection: "Gravity direction",
  gravityStrength: "Gravity strength",
  gravityNone: "None",
  gravityDown: "Down",
  gravityUp: "Up",
  gravityLeft: "Left",
  gravityRight: "Right",
  autoMotion: "Wobble automatically",
  autoHelp: "Automatically wobbles the painted area",
  sway: "Side-to-side",
  hop: "Jump up and down",
  orbit: "Circle around",
  autoStrength: "Automatic wobble strength",
  autoPeriod: "Automatic wobble period",
  sensorEnable: "Enable motion sensor",
  sensorDisable: "Disable sensor",
  recorderTitle: "Record and save",
  recorderHelp:
    "Records the movement as you wobble the image (recording starts after 3 seconds)",
  record: "Start recording",
  stop: "Stop recording",
  countdown: "Recording in",
  recording: "Recording",
  encoding: "Creating media",
  cancel: "Cancel",
  duration: "Recording time",
  seconds: "s",
  recordingView: "Recording appearance",
  viewOriginal: "As is (Recommended)",
  viewCrop: "Crop frame edges",
  viewFollow: "Camera follow",
  viewOriginalHelp:
    "Records whole-image movement as is. This is the recommended setting.",
  viewCropHelp:
    "Keeps whole-image movement and enlarges the image to prevent exposed edges.",
  viewFollowHelp:
    "Follows the image center while recording to prevent edges exposed by whole-image movement. Painted areas wobble as usual.",
  save: "Save",
  share: "Save to Photos",
  exportFailed: "Export failed. Try another format.",
  unsupported: "Unavailable in this browser",
  footerTitle: "Terms and data handling",
  footerLocal:
    "Images, area data, and recordings are processed only in your browser. They are neither sent to nor stored on a server. Only your language setting is stored persistently.",
  footerRights:
    "Do not use material that infringes third-party rights. You are responsible for checking rights to input material, applicable laws, and third-party service terms.",
  footerCommercial:
    "Outputs created with this app may be used commercially. This does not grant any new rights to the input material itself.",
  footerDisclaimer:
    "To the extent permitted by law, the developer is not liable for loss arising from use of this app. Back up important data before use.",
  fileErrorMultiple: "Choose exactly one image.",
  fileErrorType: "Choose a still PNG, JPEG, or WebP image.",
  fileErrorSize: "The file is too large. Choose an image under 80 MB.",
  fileErrorAnimated: "Animated images are not supported. Choose a still image.",
  fileErrorDecode:
    "The image could not be read. Check that the file is not damaged.",
  fileErrorDimensions:
    "This image could not be downscaled safely on this device. Choose another image or resize it before trying again.",
};

const translatedOverrides: Partial<Record<Language, Partial<Translation>>> = {
  de: {
    appTitle: "Open Purupuru Maker",
    language: "Sprache",
    edit: "Malen",
    play: "Wackeln",
    imageTitle: "Bild laden",
    selectFile: "Datei auswählen",
    record: "Aufnahme starten",
    save: "Speichern",
  },
  fr: {
    appTitle: "Open Purupuru Maker",
    language: "Langue",
    edit: "Peindre",
    play: "Bouger",
    imageTitle: "Charger une image",
    selectFile: "Choisir un fichier",
    record: "Enregistrer",
    save: "Sauvegarder",
  },
  es: {
    appTitle: "Open Purupuru Maker",
    language: "Idioma",
    edit: "Pintar",
    play: "Mover",
    imageTitle: "Cargar una imagen",
    selectFile: "Elegir un archivo",
    record: "Grabar",
    save: "Guardar",
  },
  it: {
    appTitle: "Open Purupuru Maker",
    language: "Lingua",
    edit: "Dipingi",
    play: "Muovi",
    imageTitle: "Carica un'immagine",
    selectFile: "Scegli un file",
    record: "Registra",
    save: "Salva",
  },
  pt: {
    appTitle: "Open Purupuru Maker",
    language: "Idioma",
    edit: "Pintar",
    play: "Balançar",
    imageTitle: "Carregar imagem",
    selectFile: "Escolher arquivo",
    record: "Gravar",
    save: "Salvar",
  },
  ru: {
    appTitle: "Open Purupuru Maker",
    language: "Язык",
    edit: "Закрасить",
    play: "Трясти",
    imageTitle: "Загрузить изображение",
    selectFile: "Выбрать файл",
    record: "Начать запись",
    save: "Сохранить",
  },
  uk: {
    appTitle: "Open Purupuru Maker",
    language: "Мова",
    edit: "Зафарбувати",
    play: "Хитати",
    imageTitle: "Завантажити зображення",
    selectFile: "Вибрати файл",
    record: "Почати запис",
    save: "Зберегти",
  },
  ko: {
    appTitle: "오픈 푸루푸루 메이커",
    language: "언어",
    edit: "칠하기",
    play: "흔들기",
    imageTitle: "이미지 불러오기",
    selectFile: "파일 선택",
    record: "녹화 시작",
    save: "저장",
  },
  th: {
    appTitle: "Open Purupuru Maker",
    language: "ภาษา",
    edit: "ระบาย",
    play: "ขยับ",
    imageTitle: "โหลดรูปภาพ",
    selectFile: "เลือกไฟล์",
    record: "เริ่มบันทึก",
    save: "บันทึก",
  },
  id: {
    appTitle: "Open Purupuru Maker",
    language: "Bahasa",
    edit: "Warnai",
    play: "Goyang",
    imageTitle: "Muat gambar",
    selectFile: "Pilih file",
    record: "Mulai rekam",
    save: "Simpan",
  },
  vi: {
    appTitle: "Open Purupuru Maker",
    language: "Ngôn ngữ",
    edit: "Tô",
    play: "Rung",
    imageTitle: "Tải ảnh",
    selectFile: "Chọn tệp",
    record: "Bắt đầu ghi",
    save: "Lưu",
  },
  "zh-CN": {
    appTitle: "Open Purupuru Maker",
    language: "语言",
    edit: "填色",
    play: "晃动",
    imageTitle: "读取图片",
    selectFile: "选择文件",
    record: "开始录制",
    save: "保存",
  },
  "zh-TW": {
    appTitle: "Open Purupuru Maker",
    language: "語言",
    edit: "填色",
    play: "搖晃",
    imageTitle: "讀取圖片",
    selectFile: "選擇檔案",
    record: "開始錄製",
    save: "儲存",
  },
  "zh-HK": {
    appTitle: "Open Purupuru Maker",
    language: "語言",
    edit: "填色",
    play: "搖動",
    imageTitle: "讀取圖片",
    selectFile: "選擇檔案",
    record: "開始錄製",
    save: "儲存",
  },
};

function getFallbackTranslation(language: Language): Translation {
  if (language === "ja") return japanese;
  return { ...english, ...translatedOverrides[language] };
}

function getImmediateTranslation(language: Language): Translation | null {
  if (language === "ja" || language === "en") return getFallbackTranslation(language);
  return null;
}

async function loadTranslation(language: Language): Promise<Translation> {
  const immediateTranslation = getImmediateTranslation(language);
  if (immediateTranslation) return immediateTranslation;

  try {
    const { localizedTranslations } = await import("./locales");
    return {
      ...getFallbackTranslation(language),
      ...localizedTranslations[language as keyof typeof localizedTranslations],
    };
  } catch (error) {
    console.error(`Failed to load the ${language} translation`, error);
    return getFallbackTranslation(language);
  }
}

function detectLanguage(language = navigator.language): Language {
  const normalized = language.toLowerCase();
  if (normalized.startsWith("zh-hk") || normalized.includes("hant-hk")) {
    return "zh-HK";
  }
  if (
    normalized.startsWith("zh-tw") || normalized.includes("hant-tw") ||
    normalized === "zh-hant"
  ) return "zh-TW";
  if (normalized.startsWith("zh")) return "zh-CN";
  const directLanguage = languages.find((candidate) =>
    normalized.startsWith(candidate.toLowerCase())
  );
  return directLanguage ?? "ja";
}

function getInitialLanguage(): Language {
  const savedLanguage = localStorage.getItem("purupuru-language");
  return languages.includes(savedLanguage as Language)
    ? savedLanguage as Language
    : detectLanguage();
}

type TranslationState = {
  language: Language;
  copy: Translation;
};

type I18nContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  copy: Translation;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [initialLanguage] = useState(getInitialLanguage);
  const [translationState, setTranslationState] = useState<TranslationState | null>(() => {
    const initialCopy = getImmediateTranslation(initialLanguage);
    return initialCopy ? { language: initialLanguage, copy: initialCopy } : null;
  });
  const translationRequestId = useRef(0);

  const setLanguage = useCallback((language: Language) => {
    const requestId = ++translationRequestId.current;
    const immediateTranslation = getImmediateTranslation(language);
    if (immediateTranslation) {
      setTranslationState({ language, copy: immediateTranslation });
      return;
    }

    void loadTranslation(language).then((copy) => {
      if (translationRequestId.current !== requestId) return;
      setTranslationState({ language, copy });
    });
  }, []);

  useEffect(() => {
    if (translationState) return;
    setLanguage(initialLanguage);
  }, [initialLanguage, setLanguage, translationState]);

  useEffect(() => {
    if (!translationState) return;
    document.documentElement.lang = translationState.language;
    document.title = appTitle;
    localStorage.setItem("purupuru-language", translationState.language);
  }, [translationState]);

  const contextValue = useMemo<I18nContextValue | null>(
    () => translationState ? { ...translationState, setLanguage } : null,
    [setLanguage, translationState],
  );
  if (!contextValue) return null;
  return <I18nContext value={contextValue}>{children}</I18nContext>;
}

export function useI18n() {
  const contextValue = useContext(I18nContext);
  if (!contextValue) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return contextValue;
}
