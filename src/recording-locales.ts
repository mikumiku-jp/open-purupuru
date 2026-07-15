import type { Language } from "./types";

type RecordingCopy = {
  imageAlt: string;
  maximumLabel: (seconds: number) => string;
  durationLabel: (seconds: number) => string;
};

export const recordingLocales = {
  ja: {
    imageAlt: "編集する画像",
    maximumLabel: (seconds) => `最大${seconds}秒`,
    durationLabel: (seconds) => `${seconds}秒`,
  },
  en: {
    imageAlt: "Image being edited",
    maximumLabel: (seconds) => `up to ${seconds} sec`,
    durationLabel: (seconds) => `${seconds} sec`,
  },
  de: {
    imageAlt: "Bild in Bearbeitung",
    maximumLabel: (seconds) => `bis zu ${seconds} Sek.`,
    durationLabel: (seconds) => `${seconds} Sek.`,
  },
  fr: {
    imageAlt: "Image en cours de modification",
    maximumLabel: (seconds) => `jusqu'à ${seconds} s`,
    durationLabel: (seconds) => `${seconds} s`,
  },
  es: {
    imageAlt: "Imagen que se está editando",
    maximumLabel: (seconds) => `hasta ${seconds} s`,
    durationLabel: (seconds) => `${seconds} s`,
  },
  it: {
    imageAlt: "Immagine in modifica",
    maximumLabel: (seconds) => `fino a ${seconds} s`,
    durationLabel: (seconds) => `${seconds} s`,
  },
  pt: {
    imageAlt: "Imagem em edição",
    maximumLabel: (seconds) => `até ${seconds} s`,
    durationLabel: (seconds) => `${seconds} s`,
  },
  ru: {
    imageAlt: "Редактируемое изображение",
    maximumLabel: (seconds) => `до ${seconds} с`,
    durationLabel: (seconds) => `${seconds} с`,
  },
  uk: {
    imageAlt: "Зображення, що редагується",
    maximumLabel: (seconds) => `до ${seconds} с`,
    durationLabel: (seconds) => `${seconds} с`,
  },
  ko: {
    imageAlt: "편집 중인 이미지",
    maximumLabel: (seconds) => `최대 ${seconds}초`,
    durationLabel: (seconds) => `${seconds}초`,
  },
  th: {
    imageAlt: "รูปภาพที่กำลังแก้ไข",
    maximumLabel: (seconds) => `สูงสุด ${seconds} วินาที`,
    durationLabel: (seconds) => `${seconds} วินาที`,
  },
  id: {
    imageAlt: "Gambar yang sedang diedit",
    maximumLabel: (seconds) => `maksimal ${seconds} detik`,
    durationLabel: (seconds) => `${seconds} detik`,
  },
  vi: {
    imageAlt: "Hình ảnh đang chỉnh sửa",
    maximumLabel: (seconds) => `tối đa ${seconds} giây`,
    durationLabel: (seconds) => `${seconds} giây`,
  },
  "zh-CN": {
    imageAlt: "正在编辑的图片",
    maximumLabel: (seconds) => `最长${seconds}秒`,
    durationLabel: (seconds) => `${seconds}秒`,
  },
  "zh-TW": {
    imageAlt: "正在編輯的圖片",
    maximumLabel: (seconds) => `最長${seconds}秒`,
    durationLabel: (seconds) => `${seconds}秒`,
  },
  "zh-HK": {
    imageAlt: "正在編輯的圖片",
    maximumLabel: (seconds) => `最長${seconds}秒`,
    durationLabel: (seconds) => `${seconds}秒`,
  },
} satisfies Record<Language, RecordingCopy>;
