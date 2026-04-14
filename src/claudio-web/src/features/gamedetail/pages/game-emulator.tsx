import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, resolveServerUrl } from "../../core/api/client";
import { useArrowNav } from "../../core/hooks/use-arrow-nav";
import { useGamepadDirectionalKeyBridge } from "../../core/hooks/use-gamepad-directional-key-bridge";
import { useInputScope, useInputScopeState } from "../../core/hooks/use-input-scope";
import { useGamepadEvent, useShortcut } from "../../core/hooks/use-shortcut";
import type { Game } from "../../core/types/models";
import { formatPlatform } from "../../core/utils/platforms";
import { isEmulatorFullscreenEnabled } from "../../core/utils/preferences";
import { sounds } from "../../core/utils/sounds";
import { useDesktopShellNavigation } from "../../desktop/hooks/use-desktop-shell-navigation";

interface EmulationInfo {
  supported: boolean;
  core?: string;
  requiresThreads: boolean;
  reason?: string;
  preferredPath?: string;
  candidates: string[];
}

interface EmulationSession {
  ticket: string;
  gameUrl: string;
}

export default function GameEmulator() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isActionBlocked } = useInputScopeState();
  const { focusSidebar } = useDesktopShellNavigation();
  const candidateSelectBridgeId = useId();
  const [selectedPath, setSelectedPath] = useState("");
  const [activePath, setActivePath] = useState("");

  useInputScope({ id: "game-emulator-page", kind: "page" });
  useGamepadDirectionalKeyBridge(candidateSelectBridgeId);

  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const pageReference = useRef<HTMLDivElement>(null);
  const focusAnchorReference = useRef<HTMLDivElement>(null);
  const startButtonReference = useRef<HTMLButtonElement>(null);
  const emulatorSurfaceReference = useRef<HTMLDivElement>(null);
  const iframeReference = useRef<HTMLIFrameElement>(null);

  const { data: game, isLoading: gameLoading } = useQuery({
    queryKey: ["game", id],
    queryFn: () => api.get<Game>(`/games/${id}`),
  });

  const { data: emulation, isLoading: emulationLoading } = useQuery({
    queryKey: ["emulation", id],
    queryFn: () => api.get<EmulationInfo>(`/games/${id}/emulation`),
    enabled: Boolean(id),
  });

  const [previousPreferredPath, setPreviousPreferredPath] = useState<string | undefined>();
  if (emulation?.preferredPath !== previousPreferredPath) {
    setPreviousPreferredPath(emulation?.preferredPath);
    if (emulation?.preferredPath && !selectedPath) {
      setSelectedPath(emulation.preferredPath);
    }
  }

  const sessionMutation = useMutation({
    mutationFn: ({ path }: { path: string }) =>
      api.post<EmulationSession>(`/games/${id}/emulation/session`, { path }),
    onSuccess: (session) => {
      if (!game || !emulation?.core) return;

      const parameters = new URLSearchParams({
        core: emulation.core,
        gameUrl: resolveServerUrl(session.gameUrl),
        gameName: game.title,
      });

      if (emulation.requiresThreads) {
        parameters.set("threads", "1");
      }

      setFrameUrl(`/emulator/index.html?${parameters.toString()}`);
    },
  });

  const gameId = game?.id;

  useEffect(() => {
    requestAnimationFrame(() => {
      const startButton = startButtonReference.current;
      if (startButton && !startButton.disabled) {
        startButton.focus({ focusVisible: true } as FocusOptions);
        return;
      }

      focusAnchorReference.current?.focus();
    });
  }, []);

  useShortcut(
    "escape",
    () => {
      if (isActionBlocked("page-nav")) return;
      if (frameUrl) return;
      void sounds.back();
      void navigate(`/games/${gameId}`);
    },
    { enabled: Boolean(gameId) },
  );

  useEffect(() => {
    if (!frameUrl) return;
    document.body.dataset.emulatorActive = "true";
    return () => {
      delete document.body.dataset.emulatorActive;
    };
  }, [frameUrl]);

  const focusNav = useCallback((index: number) => {
    const items = [
      ...(pageReference.current?.querySelectorAll<HTMLElement>("[data-nav]") ?? []),
    ].filter(
      (element) =>
        !element.hasAttribute("disabled") &&
        element.getAttribute("aria-hidden") !== "true" &&
        element.offsetParent !== null,
    );

    const target = items[index];
    if (!target) return;
    target.focus({ focusVisible: true } as FocusOptions);
    void sounds.navigate();
  }, []);

  const handleNavKeyDown = useArrowNav(pageReference, { onExitLeft: focusSidebar });

  const canStart = emulation?.supported && Boolean(selectedPath);

  const startEmulation = useCallback(async () => {
    if (!selectedPath) return;

    setActivePath(selectedPath);
    sessionMutation.mutate({ path: selectedPath });

    if (isEmulatorFullscreenEnabled()) {
      try {
        await emulatorSurfaceReference.current?.requestFullscreen();
      } catch {
        // Fullscreen may be denied; continue without it
      }
    }
  }, [selectedPath, sessionMutation]);

  useGamepadEvent(
    "gamepad-start",
    () => {
      if (isActionBlocked("page-nav")) return;
      if (!frameUrl && canStart && !sessionMutation.isPending) {
        void startEmulation();
      }
    },
    !frameUrl && !isActionBlocked("page-nav"),
  );

  if (gameLoading || emulationLoading) {
    return (
      <div className="min-h-screen bg-grid">
        <div className="mx-auto max-w-7xl px-6 py-10">
          <p className="text-sm text-text-muted">Loading emulator setup...</p>
        </div>
      </div>
    );
  }

  if (!game || !emulation) {
    return (
      <div className="min-h-screen bg-grid">
        <div className="mx-auto max-w-7xl px-6 py-10">
          <p className="text-sm text-red-400">Game not found.</p>
        </div>
      </div>
    );
  }

  const hasQueuedSelection = Boolean(frameUrl) && activePath !== selectedPath;

  return (
    <div ref={pageReference} className="min-h-screen bg-grid" onKeyDown={handleNavKeyDown}>
      <div className="mx-auto max-w-7xl px-6 pb-8 space-y-6">
        <div
          ref={focusAnchorReference}
          tabIndex={0}
          className="h-0 overflow-hidden outline-none"
          onKeyDown={(e) => {
            if (isActionBlocked("page-nav")) {
              return;
            }

            if (e.key === "ArrowDown" || e.key === "ArrowRight") {
              e.preventDefault();
              focusNav(0);
            } else if (e.key === "ArrowLeft" && focusSidebar()) {
              e.preventDefault();
            }
          }}
        />

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Link
              to={`/games/${game.id}`}
              data-nav
              onKeyDown={(e) => {
                if (e.key === "Enter") void sounds.back();
              }}
              className="rounded text-sm text-text-muted transition hover:text-accent outline-none focus-visible:[box-shadow:0_0_0_4px_var(--bg),0_0_0_6px_var(--focus-ring)]"
            >
              ← Back to {game.title}
            </Link>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="inline-flex items-center rounded-full bg-surface-raised px-3 py-1 text-text-secondary ring-1 ring-border">
                {formatPlatform(game.platform)}
              </span>
              <span className="inline-flex items-center rounded-full bg-surface-raised px-3 py-1 text-text-secondary ring-1 ring-border">
                {game.title}
              </span>
            </div>
          </div>

          <div className="ml-auto flex items-end gap-3">
            {emulation.supported && emulation.candidates.length > 1 && (
              <div className="flex items-center gap-3">
                <label className="text-xs font-medium uppercase tracking-[0.18em] text-text-muted">
                  ROM
                </label>
                <select
                  data-nav
                  data-gamepad-nav-bridge={candidateSelectBridgeId}
                  value={selectedPath}
                  onChange={(event) => {
                    setSelectedPath(event.target.value);
                  }}
                  className="min-w-80 rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm text-text-primary transition focus:border-focus-ring"
                >
                  {emulation.candidates.map((candidate) => (
                    <option key={candidate} value={candidate}>
                      {candidate}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {emulation.supported ? (
          <>
            {(sessionMutation.isPending ||
              emulation.requiresThreads ||
              sessionMutation.isError ||
              hasQueuedSelection) && (
              <div className="space-y-2">
                {sessionMutation.isPending && (
                  <p className="text-sm text-text-secondary">Preparing emulator...</p>
                )}
                {hasQueuedSelection && (
                  <p className="text-sm text-accent">
                    The selected ROM changed. Restart the emulator to switch to it.
                  </p>
                )}
                {emulation.requiresThreads && (
                  <p className="text-xs leading-relaxed text-amber-300">
                    This core benefits from `SharedArrayBuffer` support. If it fails to boot in your
                    browser, start with a simpler core or add cross-origin isolation headers later.
                  </p>
                )}
                {sessionMutation.isError && (
                  <p className="text-sm text-red-400">
                    {sessionMutation.error instanceof Error
                      ? sessionMutation.error.message
                      : "Failed to create emulation session."}
                  </p>
                )}
              </div>
            )}

            <div className="grid gap-6">
              <section className="overflow-hidden rounded-[28px] bg-surface/95 ring-1 ring-border shadow-2xl">
                <div
                  ref={emulatorSurfaceReference}
                  className="relative h-[78vh] min-h-160 overflow-hidden bg-black"
                >
                  {/* Poster background — shown before emulator starts */}
                  {!frameUrl && game.coverUrl && (
                    <>
                      <img
                        src={game.coverUrl}
                        alt=""
                        aria-hidden
                        className="absolute inset-0 h-full w-full scale-110 object-cover blur-lg"
                      />
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,210,77,0.10),transparent_50%),linear-gradient(180deg,rgba(3,6,10,0.55),rgba(3,6,10,0.88))]" />
                    </>
                  )}

                  {frameUrl && (
                    <iframe
                      ref={iframeReference}
                      title={`${game.title} emulator`}
                      src={frameUrl}
                      className="h-full w-full bg-black"
                      allow="autoplay; fullscreen; gamepad"
                      onLoad={() => iframeReference.current?.focus()}
                    />
                  )}

                  {!frameUrl && (
                    <div className="absolute inset-0 flex items-center justify-center p-10">
                      <div className="max-w-md text-center">
                        <button
                          ref={startButtonReference}
                          data-nav
                          type="button"
                          disabled={!canStart || sessionMutation.isPending}
                          onClick={startEmulation}
                          className="inline-flex items-center gap-3 rounded-lg bg-surface-raised px-6 py-3 text-sm font-semibold text-text-primary ring-1 ring-border shadow-[0_20px_60px_rgba(0,0,0,0.45)] transition hover:border-accent hover:text-accent outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg) disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5.14v13.72c0 .79.87 1.27 1.54.84l10.28-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z" />
                          </svg>
                          {sessionMutation.isPending ? "Starting..." : "Press Start to Play"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            </div>
          </>
        ) : (
          <div className="rounded-2xl bg-red-500/10 p-5 text-sm text-red-300 ring-1 ring-red-500/30">
            {emulation.reason ?? "This game is not ready for in-browser emulation."}
          </div>
        )}
      </div>
    </div>
  );
}
