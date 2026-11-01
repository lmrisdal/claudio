interface InstallWindowsOptionsProps {
  runAsAdministrator: boolean;
  canToggleRunAsAdministrator: boolean;
  requiresAdministrator: boolean;
  isMsi: boolean;
  forceInteractive: boolean;
  onRunAsAdministratorChange: (checked: boolean) => void;
  onForceInteractiveChange: (checked: boolean) => void;
}

export default function InstallWindowsOptions({
  runAsAdministrator,
  canToggleRunAsAdministrator,
  requiresAdministrator,
  isMsi,
  forceInteractive,
  onRunAsAdministratorChange,
  onForceInteractiveChange,
}: InstallWindowsOptionsProps) {
  return (
    <>
      <label className="mt-4 flex items-start gap-2.5 cursor-pointer select-none w-fit">
        <input
          type="checkbox"
          checked={runAsAdministrator}
          disabled={!canToggleRunAsAdministrator}
          onChange={(e) => onRunAsAdministratorChange(e.target.checked)}
          className="sr-only"
        />
        <span
          aria-hidden="true"
          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
            runAsAdministrator
              ? canToggleRunAsAdministrator
                ? "border-accent bg-accent text-accent-foreground"
                : "border-accent/80 bg-accent/80 text-accent-foreground opacity-85"
              : canToggleRunAsAdministrator
                ? "border-border bg-surface-raised text-transparent"
                : "border-border/70 bg-surface-raised/80 text-transparent opacity-70"
          }`}
        >
          <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none">
            <path
              d="M3.5 8.5 6.5 11.5 12.5 4.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <div>
          <span className="text-sm text-text-primary">Run installer as administrator</span>
          {requiresAdministrator && (
            <span className="ml-2 inline-flex rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-accent">
              Required
            </span>
          )}
          <p className="text-xs text-text-muted mt-0.5">
            {canToggleRunAsAdministrator
              ? isMsi
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
          onChange={(e) => onForceInteractiveChange(e.target.checked)}
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
  );
}
