export interface LastPlayedGame {
  gameId: number;
  gameName: string;
  coverUrl?: string;
}

const LAST_PLAYED_KEY = "claudio:lastPlayed";

export function loadLastPlayed(): LastPlayedGame | null {
  try {
    const raw = localStorage.getItem(LAST_PLAYED_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LastPlayedGame;
  } catch {
    return null;
  }
}

export function saveLastPlayed(game: LastPlayedGame) {
  localStorage.setItem(LAST_PLAYED_KEY, JSON.stringify(game));
}
