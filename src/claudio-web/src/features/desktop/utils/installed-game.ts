import type { Game } from "../../core/types/models";
import type { InstalledGame } from "../hooks/use-desktop";

export function installedGameToGame(installedGame: InstalledGame): Game {
  return {
    id: installedGame.remoteGameId,
    title: installedGame.title,
    platform: installedGame.platform,
    installType: installedGame.installType,
    summary: installedGame.summary ?? undefined,
    genre: installedGame.genre ?? undefined,
    releaseYear: installedGame.releaseYear ?? undefined,
    coverUrl: installedGame.coverUrl ?? undefined,
    heroUrl: installedGame.heroUrl ?? undefined,
    developer: installedGame.developer ?? undefined,
    publisher: installedGame.publisher ?? undefined,
    gameMode: installedGame.gameMode ?? undefined,
    series: installedGame.series ?? undefined,
    franchise: installedGame.franchise ?? undefined,
    gameEngine: installedGame.gameEngine ?? undefined,
    igdbId: installedGame.igdbId ?? undefined,
    igdbSlug: installedGame.igdbSlug ?? undefined,
    sizeBytes: 0,
    folderName: "",
    isArchive: false,
    isMissing: false,
    isProcessing: false,
  };
}
