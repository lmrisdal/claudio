import { Dialog, DialogBackdrop, DialogPanel } from "@headlessui/react";
import { useState } from "react";

interface UninstallDialogProperties {
  open: boolean;
  title: string;
  onClose: () => void;
  onConfirm: (deleteFiles: boolean) => void;
}

export default function UninstallDialog({
  open,
  title,
  onClose,
  onConfirm,
}: UninstallDialogProperties) {
  const [loading, setLoading] = useState(false);

  async function handleConfirm(deleteFiles: boolean) {
    setLoading(true);
    try {
      onConfirm(deleteFiles);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="app-modal-backdrop fixed inset-0" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-md p-6 animate-[slideUpIn_150ms_ease-out]">
          <div className="flex items-start gap-4">
            <div className="p-2.5 rounded-full bg-red-500/10 shrink-0">
              <svg
                className="w-5 h-5 text-red-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold">Uninstall game</h3>
              <p className="text-sm text-text-secondary mt-1">
                Are you sure you want to uninstall{" "}
                <span className="font-medium text-text-primary">{title}</span>?
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-2">
            <button
              onClick={() => handleConfirm(true)}
              disabled={loading}
              className="w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white transition"
            >
              Uninstall and delete files
            </button>
            <button
              onClick={() => handleConfirm(false)}
              disabled={loading}
              className="w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-surface-raised hover:bg-surface-overlay disabled:opacity-60 text-text-secondary ring-1 ring-border transition"
            >
              Uninstall but keep files
            </button>
          </div>

          <div className="mt-3 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-text-muted hover:text-text-primary transition"
            >
              Cancel
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
