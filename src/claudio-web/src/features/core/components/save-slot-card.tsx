import { forwardRef, type MouseEventHandler } from "react";
import { resolveServerUrl } from "../api/client";
import { formatRelativeTime } from "../utils/format";
import DownloadIcon from "./icons/download-icon";
import SaveIcon from "./icons/save-icon";
import TrashIcon from "./icons/trash-icon";
import LoadingSpinner from "./icons/loading-spinner";

const saveSlotActions = [
  {
    label: "Load",
    icon: DownloadIcon,
    style: "text-white/70 hover:bg-white/10 hover:text-white",
  },
  {
    label: "Save",
    icon: SaveIcon,
    style: "text-white/70 hover:bg-white/10 hover:text-white",
  },
  {
    label: "Delete",
    icon: TrashIcon,
    style: "text-red-400/70 hover:bg-red-500/10 hover:text-red-400",
  },
];

interface SaveSlotCardProperties {
  screenshotUrl: string;
  createdAt: string;
  isLoading: boolean;
  isExpanded: boolean;
  activeActionIndex: number;
  onToggleExpand: () => void;
  onCollapse: () => void;
  onSave: () => void;
  onLoad: () => void;
  onDelete: () => void;
  onMouseEnter?: MouseEventHandler;
  onFocus?: () => void;
  onActionHover?: (index: number) => void;
}

const SaveSlotCard = forwardRef<HTMLButtonElement, SaveSlotCardProperties>(function SaveSlotCard(
  {
    screenshotUrl,
    createdAt,
    isLoading,
    isExpanded,
    activeActionIndex,
    onToggleExpand,
    onCollapse,
    onSave,
    onLoad,
    onDelete,
    onMouseEnter,
    onFocus,
    onActionHover,
  },
  reference,
) {
  const handlers = [onLoad, onSave, onDelete];

  return (
    <div
      className="group relative overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/8 transition-all hover:ring-white/15 has-focus-visible:ring-2 has-focus-visible:ring-focus-ring"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onCollapse}
    >
      {/* Screenshot thumbnail */}
      <button
        ref={reference}
        type="button"
        onClick={onToggleExpand}
        onFocus={onFocus}
        className="w-full outline-none"
      >
        <div className="relative aspect-video w-full overflow-hidden bg-white/5">
          <img
            src={`${resolveServerUrl(screenshotUrl)}?v=${new Date(createdAt).getTime()}`}
            alt={`Save from ${formatRelativeTime(createdAt)}`}
            className="h-full w-full object-cover"
            loading="lazy"
          />
          {isLoading && (
            <div className="app-modal-backdrop absolute inset-0 flex items-center justify-center">
              <LoadingSpinner className="h-6 w-6 text-accent" />
            </div>
          )}
        </div>
        <div className="px-2.5 py-2 text-left">
          <p className="text-xs text-white/50">{formatRelativeTime(createdAt)}</p>
        </div>
      </button>

      {/* Action buttons overlay */}
      {isExpanded && (
        <div className="app-overlay-scrim-strong app-modal-backdrop-blur absolute inset-0 flex items-center justify-center gap-2 rounded-xl">
          {saveSlotActions.map((action, index) => (
            <button
              key={action.label}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handlers[index]();
              }}
              onMouseEnter={() => onActionHover?.(index)}
              className={`flex flex-col items-center gap-1 rounded-lg p-2.5 transition-colors outline-none ${action.style} ${
                index === activeActionIndex
                  ? "overlay-reduced-active-surface ring-2 ring-accent bg-white/10"
                  : ""
              }`}
              title={action.label}
            >
              <action.icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{action.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

export default SaveSlotCard;
