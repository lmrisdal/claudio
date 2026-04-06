import { formatSize } from "../../core/utils/format";
import type { BrowseResponse } from "../shared";

interface BrowseFilesDialogProperties {
  browsePath: string | null;
  browseData?: BrowseResponse;
  browseLoading: boolean;
  onClose: () => void;
  onNavigate: (path: string) => void;
}

export default function BrowseFilesDialog({
  browsePath,
  browseData,
  browseLoading,
  onClose,
  onNavigate,
}: BrowseFilesDialogProperties) {
  if (browsePath === null) {
    return null;
  }

  const resolvedPath = browseData?.path ?? browsePath;

  return (
    <div
      className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-xl ring-1 ring-border p-6 max-w-2xl w-full mx-4 shadow-xl max-h-[80vh] flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-text-primary font-medium shrink-0">Browse Files</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition p-1 shrink-0"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-1 text-xs text-text-muted mb-3 flex-wrap">
          {resolvedPath ? (
            <>
              <button
                type="button"
                onClick={() => onNavigate("")}
                className="hover:text-text-primary transition"
              >
                /
              </button>
              {resolvedPath
                .split("/")
                .filter(Boolean)
                .map((segment, index, segments) => {
                  const segmentPath = segments.slice(0, index + 1).join("/");
                  const isLast = index === segments.length - 1;
                  return (
                    <span key={segmentPath} className="flex items-center gap-1">
                      {index > 0 && <span className="text-text-muted/50">/</span>}
                      <button
                        type="button"
                        onClick={() => onNavigate(segmentPath)}
                        className={`hover:text-text-primary transition ${isLast ? "text-text-primary font-medium" : ""}`}
                      >
                        {segment}
                      </button>
                    </span>
                  );
                })}
            </>
          ) : (
            <span className="text-text-primary font-medium">/</span>
          )}
        </div>

        <div className="overflow-y-auto flex-1 -mx-2">
          {browseLoading ? (
            <div className="flex items-center justify-center py-12 text-text-muted text-sm">
              Loading...
            </div>
          ) : browseData?.entries.length ? (
            <div className="divide-y divide-border/50">
              {resolvedPath && (
                <button
                  type="button"
                  onClick={() => {
                    const segments = resolvedPath.split("/").filter(Boolean);
                    segments.pop();
                    onNavigate(segments.join("/"));
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-surface-raised/50 transition text-left"
                >
                  <svg
                    className="w-4 h-4 text-text-muted shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
                    />
                  </svg>
                  <span className="text-text-muted">..</span>
                </button>
              )}
              {browseData.entries.map((entry) => {
                const isBrowsable = entry.isDirectory || entry.name.toLowerCase().endsWith(".zip");
                return (
                  <button
                    key={entry.name}
                    type="button"
                    onClick={() => {
                      if (isBrowsable) {
                        onNavigate(resolvedPath ? `${resolvedPath}/${entry.name}` : entry.name);
                      }
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-sm transition text-left ${
                      isBrowsable ? "hover:bg-surface-raised/50 cursor-pointer" : "cursor-default"
                    }`}
                  >
                    {entry.isDirectory ? (
                      <svg
                        className="w-4 h-4 text-accent shrink-0"
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
                    ) : (
                      <svg
                        className="w-4 h-4 text-text-muted shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                        />
                      </svg>
                    )}
                    <span
                      className={`truncate ${entry.isDirectory ? "text-text-primary" : "text-text-secondary"}`}
                    >
                      {entry.name}
                    </span>
                    {entry.size != undefined && !entry.isDirectory && (
                      <span className="ml-auto text-xs text-text-muted font-mono shrink-0">
                        {formatSize(entry.size)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center justify-center py-12 text-text-muted text-sm">
              Empty directory
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
