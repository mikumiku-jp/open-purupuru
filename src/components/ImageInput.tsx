import { useRef, useState } from "react";
import { useI18n } from "../i18n";
import type { LoadedImage } from "../types";

type Props = {
  image: LoadedImage | null;
  disabled: boolean;
  onFiles: (files: FileList) => void;
};

export function ImageInput({ image, disabled, onFiles }: Props) {
  const { copy } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  return (
    <section
      className="card image-input-card"
      aria-labelledby="image-input-title"
    >
      <div className="section-heading image-input-heading">
        <h2 id="image-input-title">{copy.imageTitle}</h2>
        <p>{copy.imageHelp}</p>
      </div>
      <div
        className={`drop-zone${isDragging ? " is-dragging" : ""}${
          image ? " has-image" : ""
        }`}
        onDragEnter={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node)
          ) setIsDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          if (!disabled) onFiles(event.dataTransfer.files);
        }}
      >
        {image
          ? (
            <div className="image-summary">
              <img src={image.url} alt="" />
              <div className="image-meta">
                <strong title={image.sourceName}>{image.sourceName}</strong>
                <span>
                  {copy.dimensions}: {`${image.sourceWidth} × ${image.sourceHeight}`}
                  {image.optimized
                    ? ` → ${copy.optimized} ${image.width} × ${image.height}`
                    : ""}
                </span>
                <span>{copy.format}: {image.format}</span>
              </div>
            </div>
          )
          : (
            <div className="drop-copy">
              <span className="drop-icon" aria-hidden="true">↧</span>
              <strong>{copy.imageDrop}</strong>
              <span>{copy.imageDropHint}</span>
            </div>
          )}
        <button
          className={image ? "secondary-button" : "primary-button"}
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          {image ? copy.replaceImage : copy.selectFile}
        </button>
        <input
          ref={inputRef}
          className="visually-hidden-input"
          type="file"
          aria-label={copy.selectFile}
          accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
          disabled={disabled}
          onChange={(event) => {
            if (event.target.files) onFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>
    </section>
  );
}
