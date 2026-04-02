import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import UninstallDialog from "../../core/components/uninstall-dialog";
import { useDownloadManager } from "../../downloads/hooks/use-download-manager-hook";
import {
  cancelInstall,
  isDesktop,
  listInstalledGames,
  openInstallFolder,
  uninstallGame,
} from "../hooks/use-desktop";
import DownloadsIcon from "./downloads-icon";
import LibraryIcon from "./library-icon";
import SettingsIcon from "./settings-icon";
import SidebarContextMenu from "./sidebar-context-menu";

export const COLLAPSED_KEY = "claudio_sidebar_collapsed";
export const WIDTH_KEY = "claudio_sidebar_width";
export const COLLAPSED_WIDTH = 56;
export const DEFAULT_WIDTH = 220;
export const HEADER_HEIGHT = 56;
const MIN_WIDTH = 160;
const MAX_WIDTH = 400;

export default function DesktopSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === "true");
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem(WIDTH_KEY);
    return saved ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Number(saved))) : DEFAULT_WIDTH;
  });
  const isResizing = useRef(false);
  const [dragging, setDragging] = useState(false);
  const { activeCount } = useDownloadManager();
  const navReference = useRef<HTMLElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    gameId: number;
    x: number;
    y: number;
    type: "installed" | "installing";
  } | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<{
    id: number;
    title: string;
  } | null>(null);

  const { data: installedGames = [] } = useQuery({
    queryKey: ["installedGames"],
    queryFn: listInstalledGames,
    refetchInterval: 30_000,
  });
  const { activeDownloads } = useDownloadManager();

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, String(collapsed));
    globalThis.dispatchEvent(
      new CustomEvent("sidebar-collapse-changed", {
        detail: { dragging: false },
      }),
    );
  }, [collapsed]);

  useEffect(() => {
    localStorage.setItem(WIDTH_KEY, String(width));
    globalThis.dispatchEvent(
      new CustomEvent("sidebar-collapse-changed", {
        detail: { dragging: dragging },
      }),
    );
  }, [width, dragging]);

  const navItems = [
    { to: "/", icon: LibraryIcon, label: "Library" },
    {
      to: "/downloads",
      icon: DownloadsIcon,
      label: "Downloads",
      badge: activeCount > 0 ? activeCount : undefined,
    },
  ];

  const isActive = (path: string) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      setDragging(true);
      const startX = e.clientX;
      const startWidth = width;

      function onMouseMove(e: MouseEvent) {
        if (!isResizing.current) return;
        const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + e.clientX - startX));
        setWidth(newWidth);
      }

      function onMouseUp() {
        isResizing.current = false;
        setDragging(false);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [width],
  );

  const sidebarWidth = collapsed ? COLLAPSED_WIDTH : width;
  const sidebarTop = HEADER_HEIGHT;

  if (!isDesktop) return null;

  return (
    <nav
      ref={navReference}
      style={{
        width: sidebarWidth,
        top: sidebarTop,
        height: `calc(100dvh - ${sidebarTop}px)`,
      }}
      className={`desktop-sidebar fixed left-0 z-40 flex flex-col border-r border-border bg-bg select-none ${dragging ? "" : "transition-[width] duration-200 ease-in-out"}`}
      aria-label="Desktop navigation"
    >
      {/* Navigation items */}
      <div className="flex flex-col gap-1.5 px-2 pt-2">
        {navItems.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={`flex items-center gap-3 rounded-lg transition text-sm font-medium ${
              collapsed ? "justify-center p-2.5" : "px-3 py-2"
            } ${
              isActive(item.to)
                ? "bg-surface-raised text-text-primary"
                : "text-text-secondary hover:text-text-primary hover:bg-surface-raised/50"
            }`}
            title={collapsed ? item.label : undefined}
          >
            <span className="relative shrink-0">
              <item.icon className="w-4.5 h-4.5" />
              {item.badge != undefined && (
                <span className="absolute -top-1.5 -right-2 min-w-4 h-4 flex items-center justify-center rounded-full bg-accent text-neutral-950 text-[10px] font-bold px-1">
                  {item.badge}
                </span>
              )}
            </span>
            {!collapsed && <span className="truncate">{item.label}</span>}
          </Link>
        ))}

        {/* Settings button */}
        <button
          onClick={() => globalThis.dispatchEvent(new CustomEvent("claudio:open-desktop-settings"))}
          className={`flex items-center gap-3 rounded-lg transition text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-surface-raised/50 ${
            collapsed ? "justify-center p-2.5" : "px-3 py-2"
          }`}
          title={collapsed ? "Settings" : undefined}
        >
          <SettingsIcon className="w-4.5 h-4.5 shrink-0" />
          {!collapsed && <span>Settings</span>}
        </button>
      </div>

      {/* Divider */}
      <div className="mx-3 my-2 border-t border-border" />

      {/* Installed games */}
      <div className="flex-1 min-h-0 flex flex-col">
        {!collapsed && (
          <div className="px-4 mb-1.5">
            <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
              Installed
            </span>
          </div>
        )}
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 space-y-1.5 scrollbar-thin">
          {installedGames.length === 0 && activeDownloads.size === 0 ? (
            !collapsed && <p className="px-2 text-xs text-text-muted italic">No games installed</p>
          ) : (
            <>
              {[...activeDownloads.values()].map(({ game, progress }) => {
                const percent = typeof progress.percent === "number" ? progress.percent : null;
                const active = location.pathname === `/games/${game.id}`;
                return (
                  <Link
                    key={`installing-${game.id}`}
                    to={`/games/${game.id}`}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({
                        gameId: game.id,
                        x: e.clientX,
                        y: e.clientY,
                        type: "installing",
                      });
                    }}
                    className={`relative flex items-center gap-2.5 rounded-lg overflow-hidden transition ${
                      collapsed ? "justify-center p-1.5" : "px-2 py-1.5"
                    } ${
                      active
                        ? "bg-surface-raised text-text-primary"
                        : "text-text-secondary hover:text-text-primary hover:bg-surface-raised/50"
                    }`}
                    title={game.title}
                  >
                    {/* Progress bar spanning the full entry width */}
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-black/30">
                      <div
                        className="h-full bg-accent transition-all duration-300"
                        style={{ width: `${percent ?? 0}%` }}
                      />
                    </div>
                    <div
                      className={`rounded overflow-hidden shrink-0 ${
                        collapsed ? "w-8 h-10" : "w-7 h-9"
                      }`}
                    >
                      {game.coverUrl ? (
                        <img src={game.coverUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-surface-raised flex items-center justify-center">
                          <svg
                            className="w-3 h-3 text-text-muted animate-spin"
                            fill="none"
                            viewBox="0 0 24 24"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="3"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                            />
                          </svg>
                        </div>
                      )}
                    </div>
                    {!collapsed && (
                      <div className="min-w-0">
                        <span className="text-xs truncate block">{game.title}</span>
                        <span className="text-[10px] text-text-muted leading-tight">
                          {percent === null ? "Preparing\u2026" : `${Math.round(percent)}%`}
                        </span>
                      </div>
                    )}
                  </Link>
                );
              })}
              {installedGames
                .filter((g) => !activeDownloads.has(g.remoteGameId))
                .map((installed) => {
                  const cover = installed.coverUrl;
                  const active = location.pathname === `/games/${installed.remoteGameId}`;
                  return (
                    <Link
                      key={installed.remoteGameId}
                      to={`/games/${installed.remoteGameId}`}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({
                          gameId: installed.remoteGameId,
                          x: e.clientX,
                          y: e.clientY,
                          type: "installed",
                        });
                      }}
                      className={`flex items-center gap-2.5 rounded-lg transition ${
                        collapsed ? "justify-center p-1.5" : "px-2 py-1.5"
                      } ${
                        active
                          ? "bg-surface-raised text-text-primary"
                          : "text-text-secondary hover:text-text-primary hover:bg-surface-raised/50"
                      }`}
                      title={installed.title}
                    >
                      {cover ? (
                        <img
                          src={cover}
                          alt=""
                          className={`rounded object-cover shrink-0 ${
                            collapsed ? "w-8 h-10" : "w-7 h-9"
                          }`}
                        />
                      ) : (
                        <div
                          className={`rounded bg-surface-raised flex items-center justify-center shrink-0 ${
                            collapsed ? "w-8 h-10" : "w-7 h-9"
                          }`}
                        >
                          <svg
                            className="w-3 h-3 text-text-muted"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 0 1-.657.643 48.39 48.39 0 0 1-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 0 1-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 0 0-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 0 1-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 0 0 .657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 0 1-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.401.604-.401.959v0c0 .333.277.599.61.58a48.1 48.1 0 0 0 5.427-.63 48.05 48.05 0 0 0 .582-4.717.532.532 0 0 0-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.959.401v0a.656.656 0 0 0 .658-.663 48.422 48.422 0 0 0-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 0 1-.61-.58v0Z"
                            />
                          </svg>
                        </div>
                      )}
                      {!collapsed && <span className="text-xs truncate">{installed.title}</span>}
                    </Link>
                  );
                })}
            </>
          )}
        </div>
      </div>

      {/* Collapse toggle */}
      <div className="px-2 py-2 border-t border-border shrink-0">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className={`flex items-center gap-3 rounded-lg transition text-sm text-text-muted hover:text-text-primary hover:bg-surface-raised/50 w-full ${
            collapsed ? "justify-center p-2.5" : "px-3 py-2"
          }`}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <svg
            className={`w-4 h-4 transition-transform ${collapsed ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5"
            />
          </svg>
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>

      {/* Context menu for installed / installing games */}
      {contextMenu && (
        <SidebarContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onViewDetails={() => {
            void navigate(`/games/${contextMenu.gameId}`);
            setContextMenu(null);
          }}
          onOpenFolder={
            contextMenu.type === "installed"
              ? () => {
                  void openInstallFolder(contextMenu.gameId);
                  setContextMenu(null);
                }
              : undefined
          }
          onUninstall={
            contextMenu.type === "installed"
              ? () => {
                  const game = installedGames.find((g) => g.remoteGameId === contextMenu.gameId);
                  setUninstallTarget({
                    id: contextMenu.gameId,
                    title: game?.title ?? "this game",
                  });
                  setContextMenu(null);
                }
              : undefined
          }
          onCancelInstall={
            contextMenu.type === "installing"
              ? () => {
                  void cancelInstall(contextMenu.gameId);
                  setContextMenu(null);
                }
              : undefined
          }
        />
      )}

      <UninstallDialog
        open={uninstallTarget !== null}
        title={uninstallTarget?.title ?? ""}
        onClose={() => setUninstallTarget(null)}
        onConfirm={async (deleteFiles) => {
          if (!uninstallTarget) return;
          await uninstallGame(uninstallTarget.id, deleteFiles);
          setUninstallTarget(null);
          void queryClient.invalidateQueries({ queryKey: ["installedGames"] });
          void queryClient.invalidateQueries({
            queryKey: ["installedGame", String(uninstallTarget.id)],
          });
        }}
      />

      {/* Resize handle */}
      {!collapsed && (
        <div
          onMouseDown={onResizeStart}
          onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
          className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-accent/40 active:bg-accent/60 transition-colors z-50"
        />
      )}
    </nav>
  );
}
