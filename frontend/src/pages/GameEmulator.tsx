import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api/client";
import { useArrowNav } from "../hooks/useArrowNav";
import { useGuide } from "../hooks/useGuide";
import { useGamepadEvent, useShortcut } from "../hooks/useShortcut";
import type { Game } from "../types/models";
import { formatPlatform } from "../utils/platforms";
import { sounds } from "../utils/sounds";

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
  const guide = useGuide();
  const [selectedPath, setSelectedPath] = useState("");
  const [activePath, setActivePath] = useState("");

  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const focusAnchorRef = useRef<HTMLDivElement>(null);
  const startButtonRef = useRef<HTMLButtonElement>(null);
  const emulatorSurfaceRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const { data: game, isLoading: gameLoading } = useQuery({
    queryKey: ["game", id],
    queryFn: () => api.get<Game>(`/games/${id}`),
  });

  const { data: emulation, isLoading: emulationLoading } = useQuery({
    queryKey: ["emulation", id],
    queryFn: () => api.get<EmulationInfo>(`/games/${id}/emulation`),
    enabled: Boolean(id),
  });

  const [prevPreferredPath, setPrevPreferredPath] = useState<
    string | undefined
  >();
  if (emulation?.preferredPath !== prevPreferredPath) {
    setPrevPreferredPath(emulation?.preferredPath);
    if (emulation?.preferredPath && !selectedPath) {
      setSelectedPath(emulation.preferredPath);
    }
  }

  const sessionMutation = useMutation({
    mutationFn: ({ path }: { path: string }) =>
      api.post<EmulationSession>(`/games/${id}/emulation/session`, { path }),
    onSuccess: (session) => {
      if (!game || !emulation?.core) return;

      const params = new URLSearchParams({
        core: emulation.core,
        gameUrl: session.gameUrl,
        gameName: game.title,
      });

      if (emulation.requiresThreads) {
        params.set("threads", "1");
      }

      setFrameUrl(`/emulator/index.html?${params.toString()}`);
    },
  });

  const gameId = game?.id;
  useEffect(() => {
    requestAnimationFrame(() => {
      const startButton = startButtonRef.current;
      if (startButton && !startButton.disabled) {
        startButton.focus({ focusVisible: true } as FocusOptions);
        return;
      }

      focusAnchorRef.current?.focus();
    });
  }, []);

  useShortcut(
    "escape",
    () => {
      if (frameUrl) return;
      sounds.back();
      navigate(`/games/${gameId}`);
    },
    { enabled: Boolean(gameId) },
  );

  useEffect(() => {
    if (!frameUrl || guide.isOpen) return;
    document.body.dataset.emulatorActive = "true";
    return () => {
      delete document.body.dataset.emulatorActive;
    };
  }, [frameUrl, guide.isOpen]);

  useEffect(() => {
    if (!game || !frameUrl) return;
    return guide.register({
      gameId: game.id,
      gameName: game.title,
      coverUrl: game.coverUrl,
      onResume: () => iframeRef.current?.focus(),
      onQuitGame: () => {
        setFrameUrl(null);
        setActivePath("");
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
      },
    });
  }, [game, frameUrl, guide]);

  const focusNav = useCallback((index: number) => {
    const items = Array.from(
      pageRef.current?.querySelectorAll<HTMLElement>("[data-nav]") ?? [],
    ).filter(
      (el) =>
        !el.hasAttribute("disabled") &&
        el.getAttribute("aria-hidden") !== "true" &&
        el.offsetParent !== null,
    );

    const target = items[index];
    if (!target) return;
    target.focus({ focusVisible: true } as FocusOptions);
    sounds.navigate();
  }, []);

  const handleNavKeyDown = useArrowNav(pageRef);

  const canStart = emulation?.supported && Boolean(selectedPath);

  const startEmulation = useCallback(async () => {
    if (!selectedPath) return;

    setActivePath(selectedPath);
    sessionMutation.mutate({ path: selectedPath });

    try {
      await emulatorSurfaceRef.current?.requestFullscreen();
    } catch {
      // Fullscreen may be denied (e.g. browser policy); continue without it
    }
  }, [selectedPath, sessionMutation]);

  useGamepadEvent(
    "gamepad-start",
    () => {
      if (!frameUrl && canStart && !sessionMutation.isPending) {
        startEmulation();
      }
    },
    !frameUrl,
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
    <div
      ref={pageRef}
      className="min-h-screen bg-grid"
      onKeyDown={handleNavKeyDown}
    >
      <div className="mx-auto max-w-7xl px-6 pb-8 space-y-6">
        <div
          ref={focusAnchorRef}
          tabIndex={0}
          className="h-0 overflow-hidden outline-none"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowRight") {
              e.preventDefault();
              focusNav(0);
            }
          }}
        />

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Link
              to={`/games/${game.id}`}
              data-nav
              onKeyDown={(e) => {
                if (e.key === "Enter") sounds.back();
              }}
              className="rounded text-sm text-text-muted transition hover:text-accent outline-none focus-visible:[box-shadow:0_0_0_4px_var(--bg),0_0_0_6px_#00d9b8]"
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

          <div className="space-y-2">
            {emulation.supported && emulation.candidates.length > 1 && (
              <div className="flex items-center gap-3">
                <label className="text-xs font-medium uppercase tracking-[0.18em] text-text-muted">
                  ROM
                </label>
                <select
                  data-nav
                  value={selectedPath}
                  onChange={(event) => {
                    setSelectedPath(event.target.value);
                  }}
                  className="min-w-80 rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm text-text-primary transition focus:border-accent"
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

        {!emulation.supported ? (
          <div className="rounded-2xl bg-red-500/10 p-5 text-sm text-red-300 ring-1 ring-red-500/30">
            {emulation.reason ??
              "This game is not ready for in-browser emulation."}
          </div>
        ) : (
          <>
            {(sessionMutation.isPending ||
              emulation.requiresThreads ||
              sessionMutation.isError ||
              hasQueuedSelection) && (
              <div className="space-y-2">
                {sessionMutation.isPending && (
                  <p className="text-sm text-text-secondary">
                    Preparing emulator...
                  </p>
                )}
                {hasQueuedSelection && (
                  <p className="text-sm text-accent">
                    The selected ROM changed. Restart the emulator to switch to
                    it.
                  </p>
                )}
                {emulation.requiresThreads && (
                  <p className="text-xs leading-relaxed text-amber-300">
                    This core benefits from `SharedArrayBuffer` support. If it
                    fails to boot in your browser, start with a simpler core or
                    add cross-origin isolation headers later.
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
                  ref={emulatorSurfaceRef}
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
                      ref={iframeRef}
                      title={`${game.title} emulator`}
                      src={frameUrl}
                      className="h-full w-full bg-black"
                      allow="autoplay; fullscreen; gamepad"
                      onLoad={() => iframeRef.current?.focus()}
                    />
                  )}

                  {!frameUrl && (
                    <div className="absolute inset-0 flex items-center justify-center p-10">
                      <div className="max-w-md text-center">
                        <button
                          ref={startButtonRef}
                          data-nav
                          type="button"
                          disabled={!canStart || sessionMutation.isPending}
                          onClick={startEmulation}
                          className="inline-flex items-center gap-3 rounded-lg bg-surface-raised px-6 py-3 text-sm font-semibold text-text-primary ring-1 ring-border shadow-[0_20px_60px_rgba(0,0,0,0.45)] transition hover:border-accent hover:text-accent outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg) disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <svg
                            className="h-5 w-5"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M8 5.14v13.72c0 .79.87 1.27 1.54.84l10.28-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z" />
                          </svg>
                          {sessionMutation.isPending
                            ? "Starting..."
                            : "Press Start to Play"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
