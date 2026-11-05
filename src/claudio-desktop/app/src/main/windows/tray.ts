import { Menu, Tray, nativeImage, nativeTheme } from "electron";
import { selectTrayIcon, type TrayIcons } from "./tray-icon";

export interface TrayActions {
  show: () => void;
  checkForUpdates: () => void;
  quit: () => void;
}

export function createTray(icons: TrayIcons, actions: TrayActions): Tray {
  const currentIcon = () =>
    nativeImage.createFromPath(selectTrayIcon(icons, process.platform, nativeTheme));
  const tray = new Tray(currentIcon());
  nativeTheme.on("updated", () => tray.setImage(currentIcon()));
  tray.setToolTip("Claudio");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show Claudio", accelerator: "CmdOrCtrl+O", click: actions.show },
      { label: "Check for Updates", click: actions.checkForUpdates },
      { type: "separator" },
      { label: "Quit", accelerator: "CmdOrCtrl+Q", click: actions.quit },
    ]),
  );
  tray.on("click", actions.show);
  return tray;
}
