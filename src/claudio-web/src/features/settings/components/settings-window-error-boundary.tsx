import { Component, type ErrorInfo, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isDesktop } from "../../desktop/hooks/use-desktop";

function closeSettingsWindow(): void {
  if (!isDesktop) return;
  void getCurrentWindow().close();
}

interface SettingsWindowErrorBoundaryState {
  hasError: boolean;
}

export default class SettingsWindowErrorBoundary extends Component<
  { children: ReactNode },
  SettingsWindowErrorBoundaryState
> {
  public static displayName = "SettingsWindowErrorBoundary";

  public state: SettingsWindowErrorBoundaryState = { hasError: false };

  public static getDerivedStateFromError(): SettingsWindowErrorBoundaryState {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Settings window crashed during render", { error, info });
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full items-center justify-center bg-surface p-6">
          <div className="w-full max-w-md rounded-xl border border-border bg-surface-raised p-5">
            <h1 className="text-base font-semibold text-text-primary">Settings failed to load</h1>
            <p className="mt-2 text-sm text-text-secondary">
              Claudio hit an error while opening this window.
            </p>
            <button
              className="mt-4 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground transition hover:bg-accent-hover"
              onClick={closeSettingsWindow}
            >
              Close window
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
