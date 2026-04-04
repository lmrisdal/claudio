import { useEffect, useState } from "react";
import { getSettings, updateSettings, type DesktopSettings } from "../../desktop/hooks/use-desktop";

type HeaderField = { name: string; value: string };

export interface AppSettingsFormState {
  serverUrl: string;
  setServerUrl: (value: string) => void;
  installPath: string;
  setInstallPath: (value: string) => void;
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
  const [installPath, setInstallPath] = useState("");
  const [closeToTray, setCloseToTray] = useState(false);
  const [hideDockIcon, setHideDockIcon] = useState(false);
  const [speedLimit, setSpeedLimit] = useState("");
  const [headers, setHeaders] = useState<HeaderField[]>([]);
  const [showHeaders, setShowHeaders] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState("");
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    if (!active) return;

    let cancelled = false;

    void getSettings().then((loadedSettings) => {
      if (cancelled) return;

      setSettings(loadedSettings);
      setServerUrl(loadedSettings.serverUrl ?? "");
      setInstallPath(loadedSettings.defaultInstallPath ?? "");
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

  function buildCustomHeaders() {
    const customHeaders: Record<string, string> = {};
    for (const header of headers) {
      const name = header.name.trim();
      const value = header.value.trim();
      if (name && value) customHeaders[name] = value;
    }
    return customHeaders;
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
      const response = await fetch(`${trimmedUrl}/api/auth/providers`, {
        headers: buildCustomHeaders(),
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

      const customHeaders = buildCustomHeaders();

      const serverChanged = trimmedUrl !== (settings.serverUrl ?? "");
      const headersChanged =
        JSON.stringify(customHeaders) !== JSON.stringify(settings.customHeaders ?? {});

      setSaving(true);
      setSaveMessage("");

      const parsedLimit = Number.parseFloat(speedLimit);
      const updated: DesktopSettings = {
        ...settings,
        serverUrl: trimmedUrl,
        defaultInstallPath: installPath.trim() || null,
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
