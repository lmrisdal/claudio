import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { useId } from "react";
import { useAuth } from "../../auth/hooks/use-auth";
import { useGamepadDirectionalKeyBridge } from "../../core/hooks/use-gamepad-directional-key-bridge";
import { useSettingsDialog } from "../../settings/hooks/use-settings-dialog";
import { isDesktop, openSettingsWindow } from "../hooks/use-desktop";

export default function DesktopSidebarFooter({ collapsed }: { collapsed: boolean }) {
  const userMenuBridgeId = useId();
  useGamepadDirectionalKeyBridge(userMenuBridgeId);

  const { user, logout } = useAuth();
  const settingsDialog = useSettingsDialog();

  if (!user) {
    return null;
  }

  return (
    <div data-tauri-drag-region className="mt-auto px-2 pb-2 pt-1 space-y-1.5 ">
      <Menu as="div" className="relative">
        <MenuButton
          data-desktop-sidebar-nav
          data-gamepad-nav-bridge={userMenuBridgeId}
          className={`w-full flex items-center gap-2 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-sidebar-hover transition outline-none ring-offset-bg focus-visible:ring-2 focus-visible:ring-focus-ring ${
            collapsed ? "justify-center p-2" : "px-2.5 py-2"
          }`}
          title={collapsed ? "User menu" : "User menu"}
        >
          <svg
            className="w-4 h-4 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"
            />
          </svg>
          {!collapsed && (
            <>
              <span className="font-mono truncate min-w-0">{user.username}</span>
              <svg
                className="w-3.5 h-3.5 opacity-50 ml-auto"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
              </svg>
            </>
          )}
        </MenuButton>

        <MenuItems
          anchor={collapsed ? "top end" : "top start"}
          data-gamepad-nav-bridge={userMenuBridgeId}
          className="z-60 mb-2 w-52 rounded-xl bg-surface-raised border border-border shadow-2xl p-1.5 focus:outline-none"
        >
          <MenuItem>
            <button
              data-gamepad-nav-bridge={userMenuBridgeId}
              onClick={() => {
                if (isDesktop) {
                  void openSettingsWindow();
                  return;
                }
                settingsDialog.openTab("account");
              }}
              className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-text-secondary data-focus:bg-surface-overlay data-focus:text-text-primary transition"
            >
              <svg
                className="w-5 h-5 opacity-60 group-data-focus:opacity-100"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"
                />
              </svg>
              Preferences
            </button>
          </MenuItem>
          <div className="my-1.5 border-t border-border/40 mx-2" />
          <MenuItem>
            <button
              data-gamepad-nav-bridge={userMenuBridgeId}
              onClick={logout}
              className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-text-muted data-focus:bg-red-500/10 data-focus:text-red-400 transition"
            >
              <svg
                className="w-5 h-5 opacity-60 group-data-focus:opacity-100"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8.25 9V5.25A2.25 2.25 0 0 1 10.5 3h6a2.25 2.25 0 0 1 2.25 2.25v13.5A2.25 2.25 0 0 1 16.5 21h-6a2.25 2.25 0 0 1-2.25-2.25V15m-3 0-3-3m0 0 3-3m-3 3H15"
                />
              </svg>
              Sign out
            </button>
          </MenuItem>
        </MenuItems>
      </Menu>
    </div>
  );
}
