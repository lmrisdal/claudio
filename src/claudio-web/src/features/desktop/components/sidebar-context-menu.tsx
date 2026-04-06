import { useEffect, useRef } from "react";
import { useInputScope } from "../../core/hooks/use-input-scope";
import { useShortcut } from "../../core/hooks/use-shortcut";

export default function SidebarContextMenu({
  x,
  y,
  onClose,
  onViewDetails,
  onOpenFolder,
  onUninstall,
  onCancelInstall,
}: {
  x: number;
  y: number;
  onClose: () => void;
  onViewDetails: () => void;
  onOpenFolder?: () => void;
  onUninstall?: () => void;
  onCancelInstall?: () => void;
}) {
  useInputScope({
    id: "sidebar-context-menu",
    kind: "menu",
    blocks: ["guide", "page-nav", "search"],
  });

  const menuReference = useRef<HTMLDivElement>(null);

  useShortcut("escape", () => onClose());

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuReference.current && !menuReference.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  // Keep menu within viewport
  const style: React.CSSProperties = {
    position: "fixed",
    left: x,
    top: y,
    zIndex: 100,
  };

  return (
    <div
      ref={menuReference}
      style={style}
      className="bg-surface-overlay border border-border rounded-lg shadow-xl py-1 min-w-44 animate-[fadeIn_100ms_ease-out]"
    >
      <button
        onClick={onViewDetails}
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
            d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
          />
        </svg>
        View details
      </button>
      {onOpenFolder && (
        <button
          onClick={onOpenFolder}
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
              d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
            />
          </svg>
          Open folder
        </button>
      )}
      {onUninstall && (
        <>
          <div className="mx-2 my-1 border-t border-border" />
          <button
            onClick={onUninstall}
            className="w-full text-left px-3 py-1.5 text-sm text-red-400 hover:bg-surface-raised transition flex items-center gap-2.5"
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
                d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
              />
            </svg>
            Uninstall…
          </button>
        </>
      )}
      {onCancelInstall && (
        <>
          <div className="mx-2 my-1 border-t border-border" />
          <button
            onClick={onCancelInstall}
            className="w-full text-left px-3 py-1.5 text-sm text-red-400 hover:bg-surface-raised transition flex items-center gap-2.5"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
            Cancel install
          </button>
        </>
      )}
    </div>
  );
}
