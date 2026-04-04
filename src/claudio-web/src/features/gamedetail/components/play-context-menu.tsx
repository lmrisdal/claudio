import { useEffect, useRef } from "react";

export default function PlayContextMenu({
  x,
  y,
  onClose,
  onChangeExecutable,
}: {
  x: number;
  y: number;
  onClose: () => void;
  onChangeExecutable: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      style={{ position: "fixed", left: x, top: y, zIndex: 100 }}
      className="bg-surface-overlay border border-border rounded-lg shadow-xl py-1 min-w-44 animate-[fadeIn_100ms_ease-out]"
    >
      <button
        onClick={onChangeExecutable}
        className="w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-raised transition flex items-center gap-2.5"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        Change executable…
      </button>
    </div>
  );
}
