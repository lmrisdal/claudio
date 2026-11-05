import { shell, type WebContents } from "electron";
import { classifyUrl } from "./navigation-policy";

export function guardNavigation(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (classifyUrl(url) === "open-external") void shell.openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (classifyUrl(url) !== "allow") event.preventDefault();
  });
}
