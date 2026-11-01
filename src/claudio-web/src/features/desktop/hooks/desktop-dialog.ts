import { getBridge } from "./desktop-bridge";

interface SelectPathOptions {
  directory: boolean;
  title: string;
  defaultPath?: string;
}

export function selectPath(options: SelectPathOptions): Promise<string | null> {
  return getBridge().openDialog(options);
}
