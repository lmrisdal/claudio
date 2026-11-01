import { Menu, Tray, nativeImage } from "electron";

export interface TrayActions {
  show: () => void;
  checkForUpdates: () => void;
  quit: () => void;
}

export function createTray(iconPath: string, actions: TrayActions): Tray {
  const icon = nativeImage.createFromPath(iconPath);
  const tray = new Tray(icon);
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
