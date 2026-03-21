export interface Game {
  id: number;
  title: string;
  platform: string;
  folderName: string;
  installType: 'portable' | 'installer';
  summary?: string;
  genre?: string;
  releaseYear?: number;
  coverUrl?: string;
  igdbId?: number;
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
}

export interface User {
  id: number;
  username: string;
  role: 'user' | 'admin';
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}
