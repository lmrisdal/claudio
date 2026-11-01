import { Dialog, DialogBackdrop, DialogPanel } from "@headlessui/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../core/api/client";
import { useInputScope } from "../../core/hooks/use-input-scope";
import { isLinux, isWindows } from "../../core/utils/os";
import { selectPath } from "../../desktop/hooks/desktop-dialog";
import { listProtonVersions, resolveInstallBrowseRoot } from "../../desktop/hooks/use-desktop";
import ExeListbox from "./exe-listbox";
import InstallLinuxOptions from "./install-linux-options";
import InstallWindowsOptions from "./install-windows-options";

export const INDIVIDUAL_FILE_DOWNLOAD_THRESHOLD = 100;

interface InstallerInspection {
  installerType: "exe" | "msi" | "unknown";
  requestsElevation: boolean;
  canPatchCopyForNonAdmin: boolean;
}

interface DownloadFilesManifestResponse {
  files: { path: string; size: number }[] | null;
}

function pathLeaf(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part) {
      return part;
    }
  }

  return "";
}

function joinPath(parent: string, leaf: string): string {
  const separator = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  return `${parent.replace(/[\\/]+$/, "")}${separator}${leaf}`;
}

function resolveBrowsedInstallTarget(selectedPath: string, currentPath: string): string {
  const leaf = pathLeaf(currentPath);
  if (!leaf || pathLeaf(selectedPath) === leaf) {
    return selectedPath;
  }

  return joinPath(selectedPath, leaf);
}

interface InstallDialogProperties {
  open: boolean;
  gameId: number;
  title: string;
  defaultPath: string;
  defaultProtonPath?: string;
  isPortable?: boolean;
  exeLabel?: string;
  exeOptions?: string[];
  installerPath?: string;
  downloadMode?: boolean;
  errorMessage?: string | null;
  onPathChange?: () => void;
  onClose: () => void;
  onConfirm: (
    path: string | undefined,
    exe?: string,
    protonPath?: string,
    desktopShortcut?: boolean,
    appMenuShortcut?: boolean,
    steamShortcut?: boolean,
    runAsAdministrator?: boolean,
    forceInteractive?: boolean,
    extract?: boolean,
  ) => void | Promise<void>;
}

export default function InstallDialog({
  open,
  gameId,
  title,
  defaultPath,
  defaultProtonPath = "UMU-Latest",
  isPortable = false,
  exeLabel,
  exeOptions = [],
  installerPath,
  downloadMode = false,
  errorMessage,
  onPathChange,
  onClose,
  onConfirm,
}: InstallDialogProperties) {
  useInputScope({
    id: "install-dialog",
    kind: "dialog",
    blocks: ["guide", "page-nav", "search"],
    enabled: open,
  });

  const [installPath, setInstallPath] = useState(defaultPath);
  const [exe, setExe] = useState("");
  const [desktopShortcut, setDesktopShortcut] = useState(false);
  const [appMenuShortcut, setAppMenuShortcut] = useState(false);
  const [protonPath, setProtonPath] = useState(defaultProtonPath);
  const [runAsAdministratorOverrides, setRunAsAdministratorOverrides] = useState<
    Record<string, boolean>
  >({});
  const [forceInteractive, setForceInteractive] = useState(false);
  const [extract, setExtract] = useState(true);

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
    enabled: open && !downloadMode && !isPortable && !!effectiveInstallerPath,
  });
  const { data: protonOptions = [] } = useQuery({
    queryKey: ["protonVersions"],
    queryFn: listProtonVersions,
    enabled: open && !downloadMode && isLinux,
  });

  const {
    data: downloadManifest,
    isPending: downloadManifestPending,
    isError: downloadManifestError,
  } = useQuery({
    queryKey: ["downloadFilesManifest", gameId],
    queryFn: () =>
      api.get<DownloadFilesManifestResponse>(`/games/${gameId}/download-files-manifest`),
    enabled: open && downloadMode,
  });

  const showExtractOption = useMemo(() => {
    if (downloadManifestPending || downloadManifestError || downloadManifest === undefined) {
      return true;
    }
    const files = downloadManifest.files;
    if (files === null) {
      return true;
    }
    if (!Array.isArray(files)) {
      return true;
    }
    return files.length >= INDIVIDUAL_FILE_DOWNLOAD_THRESHOLD;
  }, [downloadManifest, downloadManifestPending, downloadManifestError]);

  useEffect(() => {
    if (open && downloadMode && !showExtractOption) {
      setExtract(false);
    }
  }, [open, downloadMode, showExtractOption]);
  useEffect(() => {
    if (open) {
      setProtonPath(defaultProtonPath);
    }
  }, [open, defaultProtonPath]);
  useEffect(() => {
    if (
      open &&
      protonOptions.length > 0 &&
      !protonOptions.some((option) => option.value === protonPath)
    ) {
      setProtonPath(protonOptions[0].value);
    }
  }, [open, protonOptions, protonPath]);
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
      const fallbackBrowseRoot = currentPath
        ? currentPath.replace(/[\\/][^\\/]+$/, "") || currentPath
        : undefined;
      const browseRoot = currentPath
        ? ((await resolveInstallBrowseRoot(currentPath).catch(() => null)) ?? fallbackBrowseRoot)
        : undefined;
      const selected = await selectPath({
        directory: true,
        title: "Select Install Location",
        defaultPath: browseRoot,
      });

      if (selected !== null) {
        setInstallPath(
          currentPath && !downloadMode
            ? resolveBrowsedInstallTarget(selected, currentPath)
            : selected,
        );
        onPathChange?.();
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
      <DialogBackdrop className="app-modal-backdrop fixed inset-0" />
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
              <h3 className="text-lg font-semibold">
                {downloadMode ? "Download" : "Install"} {title}
              </h3>
              <p className="text-sm text-text-secondary mt-1">
                {downloadMode
                  ? "Choose where you want to download this game."
                  : "Choose where you want to install this game."}
              </p>

              <div className="mt-4">
                <label className="block text-sm font-medium text-text-primary mb-1.5">
                  {downloadMode ? "Download Location" : "Install Location"}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={installPath}
                    onChange={(e) => {
                      setInstallPath(e.target.value);
                      onPathChange?.();
                    }}
                    placeholder="e.g. C:\Games\My Game"
                    className="flex-1 rounded-lg bg-surface-raised border border-border px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-focus-ring transition"
                  />
                  <button
                    type="button"
                    onClick={handleBrowse}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-surface-raised border border-border hover:bg-surface-overlay transition text-text-primary"
                  >
                    Browse…
                  </button>
                </div>
                {errorMessage && (
                  <p className="mt-2 text-sm text-red-400" role="alert">
                    {errorMessage}
                  </p>
                )}
              </div>

              {showExePicker && !downloadMode && (
                <div className="mt-4">
                  <ExeListbox label={exeLabel} value={exe} onChange={setExe} options={exeOptions} />
                </div>
              )}

              {downloadMode && showExtractOption && (
                <label className="mt-4 flex items-start gap-2.5 cursor-pointer select-none w-fit">
                  <input
                    type="checkbox"
                    checked={extract}
                    onChange={(e) => setExtract(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded accent-accent cursor-pointer shrink-0"
                  />
                  <div>
                    <span className="text-sm text-text-primary">Extract downloaded archive</span>
                    <p className="text-xs text-text-muted mt-0.5">
                      Unpack the archive into the chosen folder after downloading.
                    </p>
                  </div>
                </label>
              )}

              {!downloadMode && isLinux && (
                <InstallLinuxOptions
                  protonPath={protonPath}
                  protonOptions={protonOptions}
                  onProtonChange={setProtonPath}
                  desktopShortcut={desktopShortcut}
                  appMenuShortcut={appMenuShortcut}
                  onDesktopShortcutChange={setDesktopShortcut}
                  onAppMenuShortcutChange={setAppMenuShortcut}
                />
              )}

              {!downloadMode && isPortable && isWindows && (
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

              {downloadMode || isPortable || !isWindows ? null : (
                <InstallWindowsOptions
                  runAsAdministrator={runAsAdministrator}
                  canToggleRunAsAdministrator={canToggleRunAsAdministrator}
                  requiresAdministrator={requiresAdministrator}
                  isMsi={installerInspection?.installerType === "msi"}
                  forceInteractive={forceInteractive}
                  onRunAsAdministratorChange={handleRunAsAdministratorChange}
                  onForceInteractiveChange={setForceInteractive}
                />
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
                void onConfirm(
                  installPath || undefined,
                  exe || undefined,
                  downloadMode || !isLinux ? undefined : protonPath,
                  downloadMode || (!isLinux && !isPortable) ? undefined : desktopShortcut,
                  downloadMode || !isLinux ? undefined : appMenuShortcut,
                  undefined,
                  downloadMode || isPortable ? undefined : runAsAdministrator,
                  downloadMode || isPortable ? undefined : forceInteractive,
                  downloadMode ? (showExtractOption ? extract : false) : undefined,
                )
              }
              disabled={!downloadMode && !canInstall}
              className="px-6 py-2 rounded-lg text-sm font-semibold bg-accent text-accent-foreground hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition shadow-sm"
            >
              {downloadMode ? "Download" : "Install"}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
