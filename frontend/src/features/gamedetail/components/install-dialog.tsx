import { Dialog, DialogBackdrop, DialogPanel } from "@headlessui/react";
import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import ExeListbox from "./exe-listbox";

interface InstallDialogProperties {
  open: boolean;
  title: string;
  defaultPath: string;
  exeLabel?: string;
  exeOptions?: string[];
  onClose: () => void;
  onConfirm: (path: string | undefined, exe?: string) => void;
}

export default function InstallDialog({
  open,
  title,
  defaultPath,
  exeLabel,
  exeOptions = [],
  onClose,
  onConfirm,
}: InstallDialogProperties) {
  const [installPath, setInstallPath] = useState(defaultPath);
  const [exe, setExe] = useState("");

  const showExePicker = exeLabel !== undefined && exeOptions.length > 0;

  async function handleBrowse() {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "Select Install Location",
        defaultPath: installPath || defaultPath || undefined,
      });

      if (selected !== null) {
        setInstallPath(Array.isArray(selected) ? selected[0] : selected);
      }
    } catch (error) {
      console.error("Failed to open dialog", error);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-black/60" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-lg p-6 animate-[slideUpIn_150ms_ease-out]">
          <div className="flex items-start gap-4">
            <div className="p-2.5 rounded-full bg-accent/10 shrink-0">
              <svg
                className="w-5 h-5 text-accent"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold">Install {title}</h3>
              <p className="text-sm text-text-secondary mt-1">
                Choose where you want to install this game.
              </p>

              <div className="mt-4">
                <label className="block text-sm font-medium text-text-primary mb-1.5">
                  Install Location
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={installPath}
                    onChange={(e) => setInstallPath(e.target.value)}
                    placeholder="Default Library Location"
                    className="flex-1 rounded-lg bg-surface-raised border border-border px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent transition"
                  />
                  <button
                    type="button"
                    onClick={handleBrowse}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-surface-raised border border-border hover:bg-surface-overlay transition text-text-primary"
                  >
                    Browse…
                  </button>
                </div>
                <p className="mt-2 text-xs text-text-muted">
                  The game will be installed in a folder named after the title inside this
                  directory.
                </p>
              </div>

              {showExePicker && (
                <div className="mt-4">
                  <ExeListbox
                    label={exeLabel}
                    value={exe}
                    onChange={setExe}
                    options={exeOptions}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-text-muted hover:text-text-primary transition"
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm(installPath || undefined, exe || undefined)}
              className="px-6 py-2 rounded-lg text-sm font-semibold bg-accent text-neutral-950 hover:bg-accent-hover transition shadow-sm"
            >
              Install
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
