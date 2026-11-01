// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanupRenderedDom, renderInDom } from "../../../test-utils/render";
import InstallLinuxOptions from "./install-linux-options";

const defaultProps = {
  protonPath: "UMU-Latest",
  protonOptions: [],
  onProtonChange: vi.fn(),
  desktopShortcut: false,
  appMenuShortcut: false,
  onDesktopShortcutChange: vi.fn(),
  onAppMenuShortcutChange: vi.fn(),
};

afterEach(() => {
  cleanupRenderedDom();
  vi.clearAllMocks();
});

describe("InstallLinuxOptions", () => {
  it("labels the Proton picker and shows the fallback before versions are available", () => {
    const { container } = renderInDom(<InstallLinuxOptions {...defaultProps} />);
    const select = container.querySelector("select")!;

    expect(select.labels?.[0]?.textContent).toBe("Proton version");
    expect(select.value).toBe("UMU-Latest");
    expect(select.options[0]?.textContent).toBe("UMU Latest");
    expect(
      document.querySelector(`[id="${select.getAttribute("aria-describedby")}"]`)?.textContent,
    ).toBe("Runs Windows games on Linux.");
  });

  it("passes the selected Proton version to the install state", async () => {
    const { container } = renderInDom(
      <InstallLinuxOptions
        {...defaultProps}
        protonOptions={[
          { label: "UMU Latest", value: "UMU-Latest" },
          { label: "Proton-CachyOS Latest", value: "cachyos" },
        ]}
      />,
    );
    const select = container.querySelector("select")!;

    await act(async () => {
      select.value = "cachyos";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(defaultProps.onProtonChange).toHaveBeenCalledWith("cachyos");
  });

  it("toggles each shortcut from its entire tile and reflects saved selection", async () => {
    const { container } = renderInDom(<InstallLinuxOptions {...defaultProps} appMenuShortcut />);
    const [desktop, appMenu] = [
      ...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ];

    expect(container.querySelector("legend")?.textContent).toBe("Create shortcuts");
    expect(desktop?.checked).toBe(false);
    expect(appMenu?.checked).toBe(true);
    expect(desktop?.labels?.[0]?.textContent).toBe("Desktop");
    expect(appMenu?.labels?.[0]?.textContent).toBe("App menu");

    await act(async () => {
      desktop?.labels?.[0]?.click();
      appMenu?.labels?.[0]?.click();
    });

    expect(defaultProps.onDesktopShortcutChange).toHaveBeenCalledWith(true);
    expect(defaultProps.onAppMenuShortcutChange).toHaveBeenCalledWith(false);
  });
});
