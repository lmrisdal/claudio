import type { Game } from "../core/types/models";

const pcPlatforms = new Set(["win", "mac", "linux"]);

export function isPcPlatform(platform: string) {
  return pcPlatforms.has(platform.toLowerCase());
}

export function getGameCoverViewTransitionName(gameId: number | string) {
  return `game-cover-${gameId}`;
}

export interface BrowseEntry {
  name: string;
  isDirectory: boolean;
  size?: number;
}

export interface BrowseResponse {
  path: string;
  insideArchive: boolean;
  entries: BrowseEntry[];
}

export interface IgdbCandidate {
  igdbId: number;
  name: string;
  summary?: string;
  genre?: string;
  releaseYear?: number;
  coverUrl?: string;
  developer?: string;
  publisher?: string;
  gameMode?: string;
  series?: string;
  franchise?: string;
  gameEngine?: string;
  platform?: string;
  platformSlug?: string;
}

export type SgdbMode = "covers" | "heroes";

export interface GameEditFormState {
  title: string;
  summary: string;
  genre: string;
  releaseYear: string;
  coverUrl: string;
  heroUrl: string;
  installType: Game["installType"];
  installerExe: string;
  gameExe: string;
  developer: string;
  publisher: string;
  gameMode: string;
  series: string;
  franchise: string;
  gameEngine: string;
  igdbId: string;
  igdbSlug: string;
}

export interface GameUpdateInput {
  title: string;
  summary: string | null;
  genre: string | null;
  releaseYear: number | null;
  coverUrl: string | null;
  heroUrl: string | null;
  installType: Game["installType"];
  installerExe: string | null;
  gameExe: string | null;
  developer: string | null;
  publisher: string | null;
  gameMode: string | null;
  series: string | null;
  franchise: string | null;
  gameEngine: string | null;
  igdbId: number | null;
  igdbSlug: string | null;
}

export interface PendingFiles {
  cover?: File;
  hero?: File;
}

export function createGameEditForm(game: Game): GameEditFormState {
  return {
    title: game.title,
    summary: game.summary ?? "",
    genre: game.genre ?? "",
    releaseYear: game.releaseYear?.toString() ?? "",
    coverUrl: game.coverUrl ?? "",
    heroUrl: game.heroUrl ?? "",
    installType: game.installType,
    installerExe: game.installerExe ?? "",
    gameExe: game.gameExe ?? "",
    developer: game.developer ?? "",
    publisher: game.publisher ?? "",
    gameMode: game.gameMode ?? "",
    series: game.series ?? "",
    franchise: game.franchise ?? "",
    gameEngine: game.gameEngine ?? "",
    igdbId: game.igdbId?.toString() ?? "",
    igdbSlug: game.igdbSlug ?? "",
  };
}

export function buildGameUpdateInput(
  game: Game,
  overrides: Partial<GameUpdateInput> = {},
): GameUpdateInput {
  return {
    title: game.title,
    summary: game.summary ?? null,
    genre: game.genre ?? null,
    releaseYear: game.releaseYear ?? null,
    coverUrl: game.coverUrl ?? null,
    heroUrl: game.heroUrl ?? null,
    installType: game.installType,
    installerExe: game.installerExe ?? null,
    gameExe: game.gameExe ?? null,
    developer: game.developer ?? null,
    publisher: game.publisher ?? null,
    gameMode: game.gameMode ?? null,
    series: game.series ?? null,
    franchise: game.franchise ?? null,
    gameEngine: game.gameEngine ?? null,
    igdbId: game.igdbId ?? null,
    igdbSlug: game.igdbSlug ?? null,
    ...overrides,
  };
}
