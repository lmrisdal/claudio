import { createContext, useContext } from "react";

export interface AccountDialogContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const AccountDialogContext = createContext<AccountDialogContextValue | null>(null);

export function useAccountDialog() {
  const context = useContext(AccountDialogContext);
  if (!context) throw new Error("useAccountDialog must be used within AccountDialogProvider");
  return context;
}
