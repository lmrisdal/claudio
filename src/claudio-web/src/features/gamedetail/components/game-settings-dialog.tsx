import { Dialog, DialogBackdrop, DialogPanel, DialogTitle, Switch } from "@headlessui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useInputScope } from "../../core/hooks/use-input-scope";
import { isLinux, isWindows } from "../../core/utils/os";
import { selectPath } from "../../desktop/hooks/desktop-dialog";
import {
  listGameExecutables,
  listProtonVersions,
  updateGameLaunchSettings,
  type InstalledGame,
} from "../../desktop/hooks/use-desktop";
import ExeListbox from "./exe-listbox";
import GameSettingRow from "./game-setting-row";

const inputClass =
  "w-full rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus-visible:ring-2 focus-visible:ring-focus-ring";
const buttonClass =
  "rounded-lg px-4 py-2.5 text-sm font-medium text-text-secondary ring-1 ring-border transition hover:text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50";

export default function GameSettingsDialog({
  game,
  onClose,
}: {
  game: InstalledGame;
  onClose: () => void;
}) {
  useInputScope({
    id: "game-settings-dialog",
    kind: "dialog",
    blocks: ["guide", "page-nav", "search"],
    enabled: true,
  });
  const queryClient = useQueryClient();
  const [gameExe, setGameExe] = useState(game.gameExe ?? "");
  const [parameters, setParameters] = useState(game.launchOptions?.parameters ?? "");
  const [administrator, setAdministrator] = useState(
    game.launchOptions?.runAsAdministrator ?? false,
  );
  const [umuGameId, setUmuGameId] = useState(game.launchOptions?.umuGameId ?? "");
  const [protonPath, setProtonPath] = useState(game.protonPath ?? "");
  const [browseError, setBrowseError] = useState<string | null>(null);
  const usesProton = isLinux && Boolean(game.winePrefix);
  const executables = useQuery({
    queryKey: ["installedGameExecutables", game.remoteGameId],
    queryFn: () => listGameExecutables(game.remoteGameId),
  });
  const proton = useQuery({
    queryKey: ["protonVersions"],
    queryFn: listProtonVersions,
    enabled: usesProton,
  });
  const save = useMutation({
    mutationFn: () =>
      updateGameLaunchSettings(game.remoteGameId, gameExe || null, protonPath.trim() || null, {
        parameters,
        runAsAdministrator: administrator,
        umuGameId: umuGameId.trim() || null,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["installedGame", String(game.remoteGameId)], updated);
      void queryClient.invalidateQueries({ queryKey: ["installedGames"] });
      onClose();
    },
  });
  const options = [...new Set([gameExe, ...(executables.data ?? [])].filter(Boolean))];
  const error =
    browseError ??
    (save.error ? String(save.error instanceof Error ? save.error.message : save.error) : null);

  async function browse() {
    try {
      setBrowseError(null);
      const selected = await selectPath({
        directory: false,
        title: "Select game executable",
        defaultPath: game.winePrefix ? `${game.winePrefix}/drive_c` : game.installPath,
      });
      if (selected) setGameExe(selected);
    } catch (error) {
      setBrowseError(String(error instanceof Error ? error.message : error));
    }
  }

  return (
    <Dialog open onClose={save.isPending ? () => {} : onClose} className="relative z-50">
      <DialogBackdrop className="app-modal-backdrop app-modal-backdrop-blur fixed inset-0" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-surface text-text-primary shadow-2xl">
          <div className="border-b border-border px-6 py-5">
            <p className="mb-1 truncate text-xs font-medium uppercase tracking-widest text-accent">
              {game.title}
            </p>
            <DialogTitle className="text-xl font-semibold">Game settings</DialogTitle>
            <p className="mt-1 text-sm text-text-muted">
              Configure what happens when you press Play.
            </p>
          </div>
          <form
            className="flex min-h-0 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <fieldset disabled={save.isPending} className="min-h-0 space-y-6 overflow-y-auto p-6">
              <section aria-labelledby="launch-options-heading">
                <h2 id="launch-options-heading" className="mb-3 text-sm font-semibold">
                  Launch options
                </h2>
                <div className="overflow-hidden rounded-xl border border-border">
                  <GameSettingRow
                    title="Launch executable"
                    description="The file Claudio starts when you press Play."
                  >
                    <div className="min-w-0 space-y-2">
                      <ExeListbox
                        label="Executable"
                        value={gameExe}
                        onChange={setGameExe}
                        options={options}
                      />
                      <button type="button" className={buttonClass} onClick={() => void browse()}>
                        Browse…
                      </button>
                      {executables.isPending && (
                        <p role="status" className="text-xs text-text-muted">
                          Finding executables…
                        </p>
                      )}
                      {executables.isError && (
                        <p role="alert" className="text-xs text-red-400">
                          Could not list executables. Use Browse to choose a file.
                        </p>
                      )}
                    </div>
                  </GameSettingRow>
                  <GameSettingRow
                    title="Launch parameters"
                    description="Optional arguments. Wrap values containing spaces in quotes."
                  >
                    <input
                      aria-label="Launch parameters"
                      className={inputClass}
                      placeholder="e.g. -fullscreen -width 1920"
                      value={parameters}
                      onChange={(event) => setParameters(event.target.value)}
                    />
                  </GameSettingRow>
                  {isWindows && (
                    <GameSettingRow
                      title="Run as administrator"
                      description="Request administrator privileges through Windows UAC."
                    >
                      <Switch
                        aria-label="Run as administrator"
                        checked={administrator}
                        onChange={setAdministrator}
                        className="group inline-flex h-6 w-11 justify-self-end rounded-full bg-surface-raised p-1 ring-1 ring-border outline-none transition data-checked:bg-accent focus-visible:ring-2 focus-visible:ring-focus-ring"
                      >
                        <span className="size-4 rounded-full bg-text-primary transition group-data-checked:translate-x-5 group-data-checked:bg-accent-foreground" />
                      </Switch>
                    </GameSettingRow>
                  )}
                </div>
              </section>
              {usesProton && (
                <section aria-labelledby="proton-heading">
                  <h2 id="proton-heading" className="text-sm font-semibold">
                    Linux · Wine/Proton
                  </h2>
                  <p className="mb-3 mt-1 text-xs text-text-muted">
                    This game runs through umu-launcher using its Wine prefix.
                  </p>
                  <div className="overflow-hidden rounded-xl border border-border">
                    <GameSettingRow
                      title="Game ID"
                      description="The UMU database ID used to apply game-specific Proton fixes."
                    >
                      <input
                        aria-label="Game ID"
                        className={inputClass}
                        placeholder="umu-default"
                        value={umuGameId}
                        onChange={(event) => setUmuGameId(event.target.value)}
                      />
                    </GameSettingRow>
                    <GameSettingRow
                      title="Proton version"
                      description="Choose an installed build or enter a path or codename. Leave empty for UMU-Latest."
                    >
                      <div className="space-y-2">
                        <select
                          aria-label="Installed Proton versions"
                          className={inputClass}
                          value={
                            proton.data?.some((option) => option.value === protonPath)
                              ? protonPath
                              : ""
                          }
                          onChange={(event) => setProtonPath(event.target.value)}
                        >
                          <option value="">Default / custom</option>
                          {proton.data?.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <input
                          aria-label="Proton path or codename"
                          className={inputClass}
                          placeholder="UMU-Latest"
                          value={protonPath}
                          onChange={(event) => setProtonPath(event.target.value)}
                        />
                        {proton.isError && (
                          <p role="alert" className="text-xs text-red-400">
                            Could not load Proton versions. Enter a path or codename.
                          </p>
                        )}
                      </div>
                    </GameSettingRow>
                  </div>
                </section>
              )}
              {error && (
                <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
                  {error}
                </p>
              )}
            </fieldset>
            <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
              <button
                type="button"
                disabled={save.isPending}
                className={buttonClass}
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={save.isPending}
                className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground outline-none transition hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50"
              >
                {save.isPending ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
