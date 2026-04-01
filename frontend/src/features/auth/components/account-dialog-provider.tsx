import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AccountDialogContext } from "../hooks/use-account-dialog";
import AccountDialog from "./account-dialog";

export default function AccountDialogProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    globalThis.addEventListener("claudio:open-account", open);
    globalThis.addEventListener("claudio:close-dialogs", close);
    return () => {
      globalThis.removeEventListener("claudio:open-account", open);
      globalThis.removeEventListener("claudio:close-dialogs", close);
    };
  }, [open, close]);

  const value = useMemo(() => ({ isOpen, open, close }), [isOpen, open, close]);

  return (
    <AccountDialogContext.Provider value={value}>
      {children}
      <AccountDialog open={isOpen} onClose={close} />
    </AccountDialogContext.Provider>
  );
}
