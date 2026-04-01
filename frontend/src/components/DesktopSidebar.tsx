import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  isDesktop,
  listInstalledGames,
  openInstallFolder,
  uninstallGame,
} from "../hooks/useDesktop";
import { useDownloadManager } from "../hooks/useDownloadManagerHook";
import type { Game } from "../types/models";
import UninstallDialog from "./UninstallDialog";

export const COLLAPSED_KEY = "claudio_sidebar_collapsed";
export const WIDTH_KEY = "claudio_sidebar_width";
export const COLLAPSED_WIDTH = 56;
export const DEFAULT_WIDTH = 220;
export const HEADER_HEIGHT = 56;
const MIN_WIDTH = 160;
const MAX_WIDTH = 400;

export default function DesktopSidebar() {
  if (!isDesktop) return null;

  return <Sidebar />;
}

function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSED_KEY) === "true",
  );
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem(WIDTH_KEY);
    return saved
      ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Number(saved)))
      : DEFAULT_WIDTH;
  });
  const isResizing = useRef(false);
  const [dragging, setDragging] = useState(false);
  const { activeCount } = useDownloadManager();
  const navRef = useRef<HTMLElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    gameId: number;
    x: number;
    y: number;
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

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, String(collapsed));
    window.dispatchEvent(
      new CustomEvent("sidebar-collapse-changed", {
        detail: { dragging: false },
      }),
    );
  }, [collapsed]);

  useEffect(() => {
    localStorage.setItem(WIDTH_KEY, String(width));
    window.dispatchEvent(
      new CustomEvent("sidebar-collapse-changed", {
        detail: { dragging: dragging },
      }),
    );
  }, [width, dragging]);

  const games = queryClient.getQueryData<Game[]>(["games"]);

  function getCover(remoteGameId: number): string | undefined {
    return games?.find((g) => g.id === remoteGameId)?.coverUrl;
  }

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
    path === "/"
      ? location.pathname === "/"
      : location.pathname.startsWith(path);

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      setDragging(true);
      const startX = e.clientX;
      const startWidth = width;

      function onMouseMove(e: MouseEvent) {
        if (!isResizing.current) return;
        const newWidth = Math.max(
          MIN_WIDTH,
          Math.min(MAX_WIDTH, startWidth + e.clientX - startX),
        );
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

  return (
    <nav
      ref={navRef}
      style={{
        width: sidebarWidth,
        top: sidebarTop,
        height: `calc(100vh - ${sidebarTop}px)`,
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
              {item.badge != null && (
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
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("claudio:open-desktop-settings"),
            )
          }
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
          {installedGames.length === 0
            ? !collapsed && (
                <p className="px-2 text-xs text-text-muted italic">
                  No games installed
                </p>
              )
            : installedGames.map((installed) => {
                const cover = getCover(installed.remoteGameId);
                const active =
                  location.pathname === `/games/${installed.remoteGameId}`;
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
                    {!collapsed && (
                      <span className="text-xs truncate">
                        {installed.title}
                      </span>
                    )}
                  </Link>
                );
              })}
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

      {/* Context menu for installed games */}
      {contextMenu && (
        <SidebarContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onViewDetails={() => {
            navigate(`/games/${contextMenu.gameId}`);
            setContextMenu(null);
          }}
          onOpenFolder={() => {
            openInstallFolder(contextMenu.gameId);
            setContextMenu(null);
          }}
          onUninstall={() => {
            const game = installedGames.find(
              (g) => g.remoteGameId === contextMenu.gameId,
            );
            setUninstallTarget({
              id: contextMenu.gameId,
              title: game?.title ?? "this game",
            });
            setContextMenu(null);
          }}
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
          queryClient.invalidateQueries({ queryKey: ["installedGames"] });
          queryClient.invalidateQueries({
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

function LibraryIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
      />
    </svg>
  );
}

function DownloadsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
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
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  );
}

function SidebarContextMenu({
  x,
  y,
  onClose,
  onViewDetails,
  onOpenFolder,
  onUninstall,
}: {
  x: number;
  y: number;
  onClose: () => void;
  onViewDetails: () => void;
  onOpenFolder: () => void;
  onUninstall: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Keep menu within viewport
  const style: React.CSSProperties = {
    position: "fixed",
    left: x,
    top: y,
    zIndex: 100,
  };

  return (
    <div
      ref={menuRef}
      style={style}
      className="bg-surface-overlay border border-border rounded-lg shadow-xl py-1 min-w-44 animate-[fadeIn_100ms_ease-out]"
    >
      <button
        onClick={onViewDetails}
        className="w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-raised transition flex items-center gap-2.5"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
          />
        </svg>
        View details
      </button>
      <button
        onClick={onOpenFolder}
        className="w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-raised transition flex items-center gap-2.5"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
          />
        </svg>
        Open folder
      </button>
      <div className="mx-2 my-1 border-t border-border" />
      <button
        onClick={onUninstall}
        className="w-full text-left px-3 py-1.5 text-sm text-red-400 hover:bg-surface-raised transition flex items-center gap-2.5"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
          />
        </svg>
        Uninstall…
      </button>
    </div>
  );
}
