import type { RefObject } from "react";

interface GameEditImageFieldProperties {
  label: string;
  value: string;
  inputReference: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onUploadClick: () => void;
  onSgdbClick: () => void;
  onFileChange: (file: File) => void;
}

export default function GameEditImageField({
  label,
  value,
  inputReference,
  onChange,
  onUploadClick,
  onSgdbClick,
  onFileChange,
}: GameEditImageFieldProperties) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-text-muted uppercase tracking-wider">
          {label}
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onUploadClick}
            className="text-xs text-accent hover:underline"
          >
            Upload
          </button>
          <input
            ref={inputReference}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                onFileChange(file);
              }
              event.target.value = "";
            }}
          />
          <span className="text-text-muted">|</span>
          <button
            type="button"
            onClick={onSgdbClick}
            className="text-xs text-accent hover:underline"
          >
            SteamGridDB
          </button>
        </div>
      </div>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="https://..."
        className="mt-1 w-full bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition"
      />
    </div>
  );
}
