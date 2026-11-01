import { describe, expect, it } from "vite-plus/test";
import { selectTrayIcon } from "../src/main/windows/tray-icon";

const icons = { onDarkPanel: "white.png", onLightPanel: "black.png" };

describe("selectTrayIcon", () => {
  it("follows the app theme on Linux", () => {
    expect(
      selectTrayIcon(icons, "linux", {
        shouldUseDarkColors: true,
        shouldUseDarkColorsForSystemIntegratedUI: false,
      }),
    ).toBe("white.png");
    expect(
      selectTrayIcon(icons, "linux", {
        shouldUseDarkColors: false,
        shouldUseDarkColorsForSystemIntegratedUI: true,
      }),
    ).toBe("black.png");
  });

  it("follows the system theme on Windows, even when the app mode differs", () => {
    expect(
      selectTrayIcon(icons, "win32", {
        shouldUseDarkColors: false,
        shouldUseDarkColorsForSystemIntegratedUI: true,
      }),
    ).toBe("white.png");
    expect(
      selectTrayIcon(icons, "win32", {
        shouldUseDarkColors: true,
        shouldUseDarkColorsForSystemIntegratedUI: false,
      }),
    ).toBe("black.png");
  });
});
