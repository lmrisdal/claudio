import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogBackdrop, DialogPanel } from "@headlessui/react";
import { useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api } from "../../core/api/client";
import { isWindows } from "../../core/utils/os";
import ExeListbox from "./exe-listbox";

interface InstallerInspection {
  installerType: "exe" | "msi" | "unknown";
  requestsElevation: boolean;
  canPatchCopyForNonAdmin: boolean;
}

interface InstallDialogProperties {
  open: boolean;
  gameId: number;
  title: string;
  defaultPath: string;
  isPortable?: boolean;
  exeLabel?: string;
  exeOptions?: string[];
  installerPath?: string;
  onClose: () => void;
  onConfirm: (
    path: string | undefined,
    exe?: string,
    desktopShortcut?: boolean,
    runAsAdministrator?: boolean,
    forceInteractive?: boolean,
  ) => void;
}

export default function InstallDialog({
  open,
  gameId,
  title,
  defaultPath,
  isPortable = false,
  exeLabel,
  exeOptions = [],
  installerPath,
  onClose,
  onConfirm,
}: InstallDialogProperties) {
  const [installPath, setInstallPath] = useState(defaultPath);
  const [exe, setExe] = useState("");
  const [desktopShortcut, setDesktopShortcut] = useState(true);
  const [runAsAdministratorOverrides, setRunAsAdministratorOverrides] = useState<
    Record<string, boolean>
  >({});
  const [forceInteractive, setForceInteractive] = useState(false);

  const showExePicker = exeLabel !== undefined && exeOptions.length > 0;
  const canInstall = !showExePicker || exe !== "";
  const effectiveInstallerPath = useMemo(() => {
    if (isPortable) {
      return;
    }

    if (showExePicker) {
      return exe || undefined;
    }

    return installerPath || undefined;
  }, [exe, installerPath, isPortable, showExePicker]);
  const { data: installerInspection } = useQuery({
    queryKey: ["installerInspection", gameId, effectiveInstallerPath],
    queryFn: () =>
      api.get<InstallerInspection>(
        `/games/${gameId}/installer-inspection?path=${encodeURIComponent(effectiveInstallerPath!)}`,
      ),
    enabled: open && !isPortable && !!effectiveInstallerPath,
  });
  const effectiveInstallerKey = effectiveInstallerPath ?? "";
  const requiresAdministrator =
    installerInspection?.installerType === "exe" && installerInspection.requestsElevation;
  const canToggleRunAsAdministrator = effectiveInstallerKey !== "" && !requiresAdministrator;
  const runAsAdministrator = requiresAdministrator
    ? true
    : (runAsAdministratorOverrides[effectiveInstallerKey] ??
      installerInspection?.requestsElevation ??
      false);

  async function handleBrowse() {
    try {
      const currentPath = installPath || defaultPath || undefined;
      // Open the parent directory so the user picks/confirms the game folder name
      const browseRoot = currentPath
        ? currentPath.replace(/[\\/][^\\/]+$/, "") || currentPath
        : undefined;
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "Select Install Location",
        defaultPath: browseRoot,
      });

      if (selected !== null) {
        setInstallPath(Array.isArray(selected) ? selected[0] : selected);
      }
    } catch (error) {
      console.error("Failed to open dialog", error);
    }
  }

  function handleRunAsAdministratorChange(checked: boolean) {
    if (!effectiveInstallerKey) {
      return;
    }

    setRunAsAdministratorOverrides((current) => ({
      ...current,
      [effectiveInstallerKey]: checked,
    }));
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
                    placeholder="e.g. C:\Games\My Game"
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
              </div>

              {showExePicker && (
                <div className="mt-4">
                  <ExeListbox label={exeLabel} value={exe} onChange={setExe} options={exeOptions} />
                </div>
              )}

              {isPortable && isWindows && (
                <label className="mt-4 flex items-center gap-2.5 cursor-pointer select-none w-fit">
                  <input
                    type="checkbox"
                    checked={desktopShortcut}
                    onChange={(e) => setDesktopShortcut(e.target.checked)}
                    className="w-4 h-4 rounded accent-accent cursor-pointer"
                  />
                  <span className="text-sm text-text-primary">Add shortcut to desktop</span>
                </label>
              )}

              {isPortable ? null : (
                <>
                  <label className="mt-4 flex items-start gap-2.5 cursor-pointer select-none w-fit">
                    <input
                      type="checkbox"
                      checked={runAsAdministrator}
                      disabled={!canToggleRunAsAdministrator}
                      onChange={(e) => handleRunAsAdministratorChange(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded accent-accent disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <div>
                      <span className="text-sm text-text-primary">
                        Run installer as administrator
                      </span>
                      <p className="text-xs text-text-muted mt-0.5">
                        {canToggleRunAsAdministrator
                          ? installerInspection?.installerType === "msi"
                            ? "MSI installers default to standard privileges unless you enable elevation."
                            : "Request administrator privileges before starting the installer."
                          : requiresAdministrator
                            ? "This installer requires administrator privileges."
                            : "Select a setup executable to inspect its administrator requirements."}
                      </p>
                    </div>
                  </label>

                  <label className="mt-4 flex items-start gap-2.5 cursor-pointer select-none w-fit">
                    <input
                      type="checkbox"
                      checked={forceInteractive}
                      onChange={(e) => setForceInteractive(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded accent-accent cursor-pointer shrink-0"
                    />
                    <div>
                      <span className="text-sm text-text-primary">Run installer interactively</span>
                      <p className="text-xs text-text-muted mt-0.5">
                        Show the installer&apos;s setup wizard instead of installing silently.
                      </p>
                    </div>
                  </label>
                </>
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
              onClick={() =>
                onConfirm(
                  installPath || undefined,
                  exe || undefined,
                  isPortable ? desktopShortcut : undefined,
                  isPortable ? undefined : runAsAdministrator,
                  isPortable ? undefined : forceInteractive,
                )
              }
              disabled={!canInstall}
              className="px-6 py-2 rounded-lg text-sm font-semibold bg-accent text-neutral-950 hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition shadow-sm"
            >
              Install
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
