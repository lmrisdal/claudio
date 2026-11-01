import { setIndexedRef as setIndexedReference } from "../../core/utils/dom";
import type { AppSettingsFormState } from "../hooks/use-app-settings-form";

export default function AppGeneralSettingsTab({
  contentRefs,
  settings,
}: {
  contentRefs: React.RefObject<(HTMLElement | null)[]>;
  settings: AppSettingsFormState;
}) {
  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          ref={(element) => setIndexedReference(contentRefs, 0, element)}
          type="checkbox"
          checked={settings.closeToTray}
          onChange={(event) => settings.setCloseToTray(event.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-border bg-surface text-accent focus:ring-2 focus:ring-focus-ring"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-text-primary">Close to tray</span>
          <span className="mt-1 block text-xs text-text-muted">
            Keep Claudio running in the system tray when the window is closed.
          </span>
        </span>
      </label>

      {settings.saveMessage && (
        <p className="px-3 text-sm text-red-400" role="alert">
          {settings.saveMessage}
        </p>
      )}
    </div>
  );
}
