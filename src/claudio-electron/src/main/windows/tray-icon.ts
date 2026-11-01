export interface TrayIcons {
  onDarkPanel: string;
  onLightPanel: string;
}

export interface PanelTheme {
  shouldUseDarkColors: boolean;
  shouldUseDarkColorsForSystemIntegratedUI: boolean;
}

export function selectTrayIcon(
  icons: TrayIcons,
  platform: NodeJS.Platform,
  theme: PanelTheme,
): string {
  // The Windows taskbar follows the system mode, which can differ from the app mode.
  const isDarkPanel =
    platform === "win32"
      ? theme.shouldUseDarkColorsForSystemIntegratedUI
      : theme.shouldUseDarkColors;
  return isDarkPanel ? icons.onDarkPanel : icons.onLightPanel;
}
