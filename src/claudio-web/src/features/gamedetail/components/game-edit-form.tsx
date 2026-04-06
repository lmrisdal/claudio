import type { RefObject } from "react";
import type { Game } from "../../core/types/models";
import { isPcPlatform, type GameEditFormState, type SgdbMode } from "../shared";
import GameEditImageField from "./game-edit-image-field";
import GameEditTextField from "./game-edit-text-field";
import GameEditTextareaField from "./game-edit-textarea-field";
import ExeListbox from "./exe-listbox";

interface GameEditFormProperties {
  game: Game;
  hasHeroImage: boolean;
  editForm: GameEditFormState;
  exeOptions: string[];
  coverFileReference: RefObject<HTMLInputElement | null>;
  heroFileReference: RefObject<HTMLInputElement | null>;
  savePending: boolean;
  saveError: string | null;
  compressPending: boolean;
  compressError: string | null;
  tagFolderPending: boolean;
  onChange: (patch: Partial<GameEditFormState>) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onOpenIgdbSearch: () => void;
  onOpenSgdb: (mode: SgdbMode) => void;
  onImageSelect: (type: "cover" | "hero", file: File) => void;
  onTagFolder: () => void;
  onCompress: (format: "zip" | "tar") => void;
}

export default function GameEditForm({
  game,
  hasHeroImage,
  editForm,
  exeOptions,
  coverFileReference,
  heroFileReference,
  savePending,
  saveError,
  compressPending,
  compressError,
  tagFolderPending,
  onChange,
  onSubmit,
  onCancel,
  onOpenIgdbSearch,
  onOpenSgdb,
  onImageSelect,
  onTagFolder,
  onCompress,
}: GameEditFormProperties) {
  const formLocked = savePending || game.isProcessing;
  const showTagFolderButton = game.igdbId && !game.folderName.includes(`igdb-${game.igdbId}`);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="space-y-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-bold text-text-primary">Edit Game</h1>
          <p className="mt-1 text-sm text-text-muted">
            Update metadata, artwork, executables, and packaging.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenIgdbSearch}
          disabled={formLocked}
          className={`shrink-0 inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition disabled:opacity-50 ${
            hasHeroImage
              ? "hero-glass-chip bg-black/30 text-white/85 ring-1 ring-white/10 backdrop-blur-sm hover:bg-black/40 hover:text-white shadow-[0_4px_20px_rgba(0,0,0,0.2)]"
              : "text-text-secondary ring-1 ring-border hover:text-text-primary hover:bg-surface-overlay"
          }`}
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
          Match on IGDB
        </button>
      </div>

      {game.isProcessing && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          This game is currently being processed. Metadata changes are temporarily disabled.
        </p>
      )}

      <fieldset disabled={formLocked} className="space-y-4 disabled:opacity-70">
        <GameEditTextField
          label="Title"
          value={editForm.title}
          required
          onChange={(value) => onChange({ title: value })}
        />

        <GameEditTextareaField
          label="Summary"
          value={editForm.summary}
          rows={4}
          onChange={(value) => onChange({ summary: value })}
        />

        <div className="grid grid-cols-2 gap-4">
          <GameEditTextField
            label="Genre"
            value={editForm.genre}
            onChange={(value) => onChange({ genre: value })}
          />
          <GameEditTextField
            label="Release Year"
            type="number"
            value={editForm.releaseYear}
            placeholder="e.g. 2025"
            onChange={(value) => onChange({ releaseYear: value })}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <GameEditTextField
            label="Developer"
            value={editForm.developer}
            onChange={(value) => onChange({ developer: value })}
          />
          <GameEditTextField
            label="Publisher"
            value={editForm.publisher}
            onChange={(value) => onChange({ publisher: value })}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <GameEditTextField
            label="Game Mode"
            value={editForm.gameMode}
            placeholder="e.g. Single player, Multiplayer"
            onChange={(value) => onChange({ gameMode: value })}
          />
          <GameEditTextField
            label="Engine"
            value={editForm.gameEngine}
            onChange={(value) => onChange({ gameEngine: value })}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <GameEditTextField
            label="Series"
            value={editForm.series}
            onChange={(value) => onChange({ series: value })}
          />
          <GameEditTextField
            label="Franchise"
            value={editForm.franchise}
            onChange={(value) => onChange({ franchise: value })}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-text-muted uppercase tracking-wider">
              IGDB ID
            </label>
            <div className="mt-1 flex gap-2">
              <input
                type="number"
                value={editForm.igdbId}
                onChange={(event) => onChange({ igdbId: event.target.value })}
                placeholder="e.g. 12345"
                className="flex-1 bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition"
              />
              {showTagFolderButton && (
                <button
                  type="button"
                  onClick={onTagFolder}
                  disabled={tagFolderPending}
                  className="shrink-0 px-3 py-2 rounded-lg text-xs text-text-secondary hover:text-text-primary hover:bg-surface-overlay ring-1 ring-border transition disabled:opacity-50"
                  title={`Rename folder to add (igdb-${game.igdbId})`}
                >
                  {tagFolderPending ? "Tagging..." : "Tag folder"}
                </button>
              )}
            </div>
          </div>

          <GameEditTextField
            label="IGDB Slug"
            value={editForm.igdbSlug}
            placeholder="e.g. the-witcher-3"
            onChange={(value) => onChange({ igdbSlug: value })}
          />
        </div>

        <GameEditImageField
          label="Cover URL"
          value={editForm.coverUrl}
          inputReference={coverFileReference}
          onChange={(value) => onChange({ coverUrl: value })}
          onUploadClick={() => coverFileReference.current?.click()}
          onSgdbClick={() => onOpenSgdb("covers")}
          onFileChange={(file) => onImageSelect("cover", file)}
        />

        <GameEditImageField
          label="Hero URL"
          value={editForm.heroUrl}
          inputReference={heroFileReference}
          onChange={(value) => onChange({ heroUrl: value })}
          onUploadClick={() => heroFileReference.current?.click()}
          onSgdbClick={() => onOpenSgdb("heroes")}
          onFileChange={(file) => onImageSelect("hero", file)}
        />

        {isPcPlatform(game.platform) && (
          <>
            <div>
              <label className="text-xs font-medium text-text-muted uppercase tracking-wider">
                Install Type
              </label>
              <div className="mt-1 flex gap-2">
                {(["portable", "installer"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => onChange({ installType: type })}
                    className={`px-4 py-2 rounded-lg text-sm font-medium ring-1 transition ${
                      editForm.installType === type
                        ? "bg-accent/15 text-accent ring-accent/30"
                        : "bg-surface-raised text-text-secondary ring-border hover:ring-accent/30"
                    }`}
                  >
                    {type === "portable" ? "Portable" : "Installer"}
                  </button>
                ))}
              </div>
            </div>

            {editForm.installType === "installer" && (
              <ExeListbox
                label="Installer Executable"
                value={editForm.installerExe}
                onChange={(value) => onChange({ installerExe: value })}
                options={exeOptions}
              />
            )}

            {editForm.installType === "portable" && (
              <ExeListbox
                label="Game Executable"
                value={editForm.gameExe}
                onChange={(value) => onChange({ gameExe: value })}
                options={exeOptions}
              />
            )}
          </>
        )}
      </fieldset>

      {saveError && <p className="text-sm text-red-400">{saveError}</p>}

      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={formLocked}
          className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-neutral-950 font-medium px-5 py-2.5 rounded-lg transition text-sm"
        >
          {savePending ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-5 py-2.5 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-surface-overlay ring-1 ring-border transition"
        >
          Cancel
        </button>

        {!game.isArchive && !game.isProcessing && (
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => onCompress("zip")}
              disabled={compressPending}
              className="px-4 py-2.5 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-surface-overlay ring-1 ring-border transition disabled:opacity-50"
            >
              {compressPending ? "Queuing..." : "Package as ZIP"}
            </button>
            <button
              type="button"
              onClick={() => onCompress("tar")}
              disabled={compressPending}
              className="px-4 py-2.5 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-surface-overlay ring-1 ring-border transition disabled:opacity-50"
            >
              {compressPending ? "Queuing..." : "Package as TAR"}
            </button>
          </div>
        )}
      </div>

      {compressError && <p className="text-sm text-red-400">{compressError}</p>}
    </form>
  );
}
