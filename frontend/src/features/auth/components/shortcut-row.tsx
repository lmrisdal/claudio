import { formatShortcut } from "../../core/utils/shortcuts";

export default function ShortcutRow({
  label,
  value,
  defaultValue,
  recording,
  onRecord,
  onReset,
  buttonRef,
}: {
  label: string;
  value: string;
  defaultValue: string;
  recording: boolean;
  onRecord: () => void;
  onReset: () => void;
  buttonRef: (element: HTMLButtonElement | null) => void;
}) {
  const isCustom = value !== defaultValue;

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-white/80">{label}</span>
      <div className="flex items-center gap-2">
        {isCustom && !recording && (
          <button
            type="button"
            onClick={onReset}
            className="text-[11px] text-white/30 hover:text-white/60 transition-colors"
            title={`Reset to ${formatShortcut(defaultValue)}`}
          >
            Reset
          </button>
        )}
        <button
          ref={buttonRef}
          type="button"
          onClick={onRecord}
          className={`inline-flex items-center gap-1.5 min-w-20 justify-center px-3 py-1.5 rounded-lg text-xs font-mono transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            recording
              ? "bg-accent/20 text-accent ring-1 ring-accent/40 animate-pulse"
              : "bg-white/14 text-white/90 ring-1 ring-white/20 hover:bg-white/20 hover:text-white"
          }`}
        >
          {recording ? "Press keys\u2026" : formatShortcut(value)}
        </button>
      </div>
    </div>
  );
}
