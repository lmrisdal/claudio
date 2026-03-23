export interface Game {
  id: number;
  title: string;
  platform: string;
  folderName: string;
  installType: "portable" | "installer";
  summary?: string;
  genre?: string;
  releaseYear?: number;
  coverUrl?: string;
  heroUrl?: string;
  igdbId?: number;
  igdbSlug?: string;
  sizeBytes: number;
  isMissing: boolean;
  installerExe?: string;
  gameExe?: string;
  developer?: string;
  publisher?: string;
  gameMode?: string;
  series?: string;
  franchise?: string;
  gameEngine?: string;
  isProcessing: boolean;
  isArchive: boolean;
}

export interface CompressionJobInfo {
  gameId: number;
  gameTitle: string;
  progressPercent?: number;
  format: string;
}

export interface CompressionStatus {
  current: CompressionJobInfo | null;
  queued: CompressionJobInfo[];
}

export interface IgdbScanStatus {
  isRunning: boolean;
  currentGame: string | null;
  total: number;
  processed: number;
  matched: number;
}

export interface SteamGridDbScanStatus {
  isRunning: boolean;
  currentGame: string | null;
  total: number;
  processed: number;
  matched: number;
}

export interface TasksStatus {
  compression: CompressionStatus;
  igdb: IgdbScanStatus;
  steamGridDb: SteamGridDbScanStatus;
}

export interface User {
  id: number;
  username: string;
  role: "user" | "admin";
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}
