import { Dialog, DialogBackdrop, DialogPanel } from "@headlessui/react";
import { useState } from "react";
import ExeListbox from "./exe-listbox";

interface PickExeDialogProperties {
  open: boolean;
  title: string;
  exeOptions: string[];
  onClose: () => void;
  onConfirm: (exe: string) => void;
}

export default function PickExeDialog({
  open,
  title,
  exeOptions,
  onClose,
  onConfirm,
}: PickExeDialogProperties) {
  const [exe, setExe] = useState(exeOptions[0] ?? "");

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-md rounded-xl bg-surface border border-border shadow-2xl p-6">
          <h2 className="text-base font-semibold text-text-primary mb-1">Select game executable</h2>
          <p className="text-sm text-text-secondary mb-5">
            Choose which executable to launch for{" "}
            <span className="text-text-primary font-medium">{title}</span>. This choice will be
            remembered.
          </p>

          {exeOptions.length > 0 ? (
            <ExeListbox label="Executable" value={exe} onChange={setExe} options={exeOptions} />
          ) : (
            <p className="text-sm text-text-muted bg-surface-raised rounded-lg px-3 py-2 border border-border">
              No executables found in the install directory.
            </p>
          )}

          <div className="flex justify-end gap-2 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-text-secondary ring-1 ring-border hover:text-text-primary transition outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg)"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!exe}
              onClick={() => {
                if (exe) onConfirm(exe);
              }}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-neutral-950 transition enabled:hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg)"
            >
              Launch
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
