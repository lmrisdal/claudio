import { useId } from "react";
import StyledSelect from "../../core/components/styled-select";
import type { ProtonVersionOption } from "../../desktop/hooks/use-desktop";

interface InstallLinuxOptionsProps {
  protonPath: string;
  protonOptions: ProtonVersionOption[];
  onProtonChange: (value: string) => void;
  desktopShortcut: boolean;
  appMenuShortcut: boolean;
  onDesktopShortcutChange: (checked: boolean) => void;
  onAppMenuShortcutChange: (checked: boolean) => void;
}

export default function InstallLinuxOptions({
  protonPath,
  protonOptions,
  onProtonChange,
  desktopShortcut,
  appMenuShortcut,
  onDesktopShortcutChange,
  onAppMenuShortcutChange,
}: InstallLinuxOptionsProps) {
  const id = useId();
  const options =
    protonOptions.length > 0 ? protonOptions : [{ label: "UMU Latest", value: "UMU-Latest" }];
  const shortcuts = [
    {
      label: "Desktop",
      checked: desktopShortcut,
      onChange: onDesktopShortcutChange,
      icon: "M3 4h18v12H3zM8 21h8m-4-5v5",
    },
    {
      label: "App menu",
      checked: appMenuShortcut,
      onChange: onAppMenuShortcutChange,
      icon: "M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h6v6h-6z",
    },
  ];

  return (
    <div className="mt-5 overflow-hidden rounded-xl border border-border bg-surface-raised/30">
      <div className="p-4">
        <label htmlFor={`${id}-proton`} className="block text-sm font-medium text-text-primary">
          Proton version
        </label>
        <p id={`${id}-proton-hint`} className="mt-1 text-xs text-text-secondary">
          Runs Windows games on Linux.
        </p>
        <div className="relative mt-3">
          <StyledSelect
            id={`${id}-proton`}
            aria-describedby={`${id}-proton-hint`}
            value={protonPath}
            onChange={(event) => onProtonChange(event.target.value)}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </StyledSelect>
        </div>
      </div>
      <fieldset className="min-w-0 border-t border-border p-4 pt-3">
        <legend className="sr-only">Create shortcuts</legend>
        <p aria-hidden="true" className="mb-2.5 text-xs font-medium text-text-secondary">
          Create shortcuts
        </p>
        <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
          {shortcuts.map((shortcut) => (
            <label key={shortcut.label} className="relative cursor-pointer select-none">
              <input
                type="checkbox"
                checked={shortcut.checked}
                onChange={(event) => shortcut.onChange(event.target.checked)}
                className="peer sr-only"
              />
              <span className="flex min-h-11 items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-text-secondary transition-colors hover:border-text-muted hover:bg-surface-raised peer-checked:border-accent/50 peer-checked:bg-accent/10 peer-checked:text-text-primary peer-focus-visible:ring-2 peer-focus-visible:ring-focus-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface">
                <svg
                  aria-hidden="true"
                  className={`h-4 w-4 shrink-0 ${shortcut.checked ? "text-accent" : "text-text-muted"}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={shortcut.icon} />
                </svg>
                <span className="flex-1 font-medium">{shortcut.label}</span>
                <span
                  aria-hidden="true"
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${shortcut.checked ? "border-accent bg-accent text-accent-foreground" : "border-border text-transparent"}`}
                >
                  <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3">
                    <path
                      d="m3.5 8 3 3 6-6"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
