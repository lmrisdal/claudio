import { useEffect, useRef, useState } from "react";
import {
  getSettings,
  resolveDefaultDownloadRoot,
  updateSettings,
  type DesktopSettings,
} from "../../desktop/hooks/use-desktop";
import { buildDesktopCustomHeaders } from "../../desktop/utils/custom-headers";

type HeaderField = { name: string; value: string };

function deriveDownloadPathFromInstallPath(installPath: string): string {
  const trimmed = installPath.trim();
  if (!trimmed) return "";

  const normalized = trimmed.replace(/[\\/]+$/, "");
  const separator = normalized.includes("\\") && !normalized.includes("/") ? "\\" : "/";
  return `${normalized}${separator}downloads`;
}

export interface AppSettingsFormState {
  serverUrl: string;
  setServerUrl: (value: string) => void;
  installPath: string;
  setInstallPath: (value: string) => void;
  downloadPath: string;
  setDownloadPath: (value: string) => void;
  closeToTray: boolean;
  setCloseToTray: (value: boolean) => void;
  hideDockIcon: boolean;
  setHideDockIcon: (value: boolean) => void;
  speedLimit: string;
  setSpeedLimit: (value: string) => void;
  headers: HeaderField[];
  setHeaders: (value: HeaderField[]) => void;
  showHeaders: boolean;
  setShowHeaders: (value: boolean) => void;
  saving: boolean;
  testing: boolean;
  connectionMessage: string;
  saveMessage: string;
  handleTest: () => Promise<void>;
  handleSave: () => Promise<void>;
}

export function useAppSettingsForm(active: boolean): AppSettingsFormState {
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [serverUrl, setServerUrl] = useState("");
  const [installPath, setInstallPathState] = useState("");
  const [downloadPath, setDownloadPathState] = useState("");
  const [resolvedDefaultDownloadRoot, setResolvedDefaultDownloadRoot] = useState("");
  const [closeToTray, setCloseToTray] = useState(false);
  const [hideDockIcon, setHideDockIcon] = useState(false);
  const [speedLimit, setSpeedLimit] = useState("");
  const [headers, setHeaders] = useState<HeaderField[]>([]);
  const [showHeaders, setShowHeaders] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const installPathEditedRef = useRef(false);
  const downloadPathEditedRef = useRef(false);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    installPathEditedRef.current = false;
    downloadPathEditedRef.current = false;

    void getSettings().then(async (loadedSettings) => {
      if (cancelled) return;

      const loadedInstallPath = loadedSettings.defaultInstallPath ?? "";
      const effectiveDefaultDownloadRoot = await resolveDefaultDownloadRoot().catch(() => "");
      const fallbackDownloadPath =
        effectiveDefaultDownloadRoot || deriveDownloadPathFromInstallPath(loadedInstallPath);
      if (cancelled) return;

      setSettings(loadedSettings);
      setServerUrl(loadedSettings.serverUrl ?? "");
      if (!installPathEditedRef.current) {
        setInstallPathState(loadedInstallPath);
      }
      setResolvedDefaultDownloadRoot(effectiveDefaultDownloadRoot);
      if (!downloadPathEditedRef.current) {
        setDownloadPathState(loadedSettings.defaultDownloadPath ?? fallbackDownloadPath);
      }
      setCloseToTray(loadedSettings.closeToTray ?? false);
      setHideDockIcon(loadedSettings.hideDockIcon ?? false);
      setSpeedLimit(
        loadedSettings.downloadSpeedLimitKbs ? String(loadedSettings.downloadSpeedLimitKbs) : "",
      );

      const customHeaders = loadedSettings.customHeaders ?? {};
      const entries = Object.entries(customHeaders).map(([name, value]) => ({
        name,
        value,
      }));

      setHeaders(entries);
      setShowHeaders(entries.length > 0);
      setConnectionMessage("");
      setSaveMessage("");
    });

    return () => {
      cancelled = true;
    };
  }, [active]);

  function setInstallPath(value: string) {
    installPathEditedRef.current = true;
    setInstallPathState(value);
  }

  function setDownloadPath(value: string) {
    downloadPathEditedRef.current = true;
    setDownloadPathState(value);
  }

  function buildCustomHeaders() {
    return buildDesktopCustomHeaders(headers);
  }

  async function handleTest() {
    const trimmedUrl = serverUrl.trim().replace(/\/+$/, "");
    if (!trimmedUrl) {
      setConnectionMessage("Server URL is required.");
      return;
    }

    setTesting(true);
    setConnectionMessage("");

    try {
      const { customHeaders, forbiddenHeaders } = buildCustomHeaders();
      if (forbiddenHeaders.length > 0) {
        setConnectionMessage(
          `These headers are managed by desktop auth and cannot be set manually: ${forbiddenHeaders.join(", ")}.`,
        );
        return;
      }

      const response = await fetch(`${trimmedUrl}/api/auth/providers`, {
        headers: customHeaders,
      });

      if (response.ok) {
        setConnectionMessage("Connection successful.");
      } else {
        setConnectionMessage(`Server responded with ${response.status}.`);
      }
    } catch {
      setConnectionMessage("Could not connect. Check the URL and try again.");
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    try {
      if (!settings) return;

      const trimmedUrl = serverUrl.trim().replace(/\/+$/, "");
      if (!trimmedUrl) {
        setSaveMessage("Server URL is required.");
        return;
      }

      const { customHeaders, forbiddenHeaders } = buildCustomHeaders();
      if (forbiddenHeaders.length > 0) {
        setSaveMessage(
          `These headers are managed by desktop auth and cannot be set manually: ${forbiddenHeaders.join(", ")}.`,
        );
        return;
      }

      const serverChanged = trimmedUrl !== (settings.serverUrl ?? "");
      const headersChanged =
        JSON.stringify(customHeaders) !== JSON.stringify(settings.customHeaders ?? {});

      setSaving(true);
      setSaveMessage("");

      const normalizedInstallPath = installPath.trim();
      const normalizedDownloadPath =
        downloadPath.trim() ||
        resolvedDefaultDownloadRoot ||
        deriveDownloadPathFromInstallPath(normalizedInstallPath);
      const parsedLimit = Number.parseFloat(speedLimit);
      const updated: DesktopSettings = {
        ...settings,
        serverUrl: trimmedUrl,
        defaultInstallPath: normalizedInstallPath || null,
        defaultDownloadPath: normalizedDownloadPath || null,
        closeToTray,
        hideDockIcon,
        customHeaders,
        downloadSpeedLimitKbs: parsedLimit > 0 ? parsedLimit : null,
      };

      await updateSettings(updated);
      localStorage.setItem("claudio_server_url", trimmedUrl);
      localStorage.setItem("claudio_custom_headers", JSON.stringify(customHeaders));

      if (serverChanged || headersChanged) {
        globalThis.location.reload();
        return;
      }

      setSettings(updated);
    } catch {
      setSaveMessage("Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  function saveGeneralSettings(updated: DesktopSettings) {
    setSaving(true);
    setSaveMessage("");

    void updateSettings(updated)
      .then(() => {
        setSettings(updated);
      })
      .catch(() => {
        setSaveMessage("Failed to save settings.");
      })
      .finally(() => {
        setSaving(false);
      });
  }

  function handleCloseToTrayChange(value: boolean) {
    setCloseToTray(value);
    if (!settings) return;

    saveGeneralSettings({
      ...settings,
      closeToTray: value,
      hideDockIcon,
    });
  }

  function handleHideDockIconChange(value: boolean) {
    setHideDockIcon(value);
    if (!settings) return;

    saveGeneralSettings({
      ...settings,
      closeToTray,
      hideDockIcon: value,
    });
  }

  return {
    serverUrl,
    setServerUrl,
    installPath,
    setInstallPath,
    downloadPath,
    setDownloadPath,
    closeToTray,
    setCloseToTray: handleCloseToTrayChange,
    hideDockIcon,
    setHideDockIcon: handleHideDockIconChange,
    speedLimit,
    setSpeedLimit,
    headers,
    setHeaders,
    showHeaders,
    setShowHeaders,
    saving,
    testing,
    connectionMessage,
    saveMessage,
    handleTest,
    handleSave,
  };
}
