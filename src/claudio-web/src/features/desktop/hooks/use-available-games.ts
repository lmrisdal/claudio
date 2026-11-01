import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "../../core/api/client";
import { SERVER_RETRY_INTERVAL_MS, useServerStatus } from "../../core/hooks/use-server-status";
import type { Game } from "../../core/types/models";
import { installedGameToGame } from "../utils/installed-game";
import { isDesktop, listInstalledGames } from "./use-desktop";

const NO_GAMES: Game[] = [];

export function useAvailableGames(refetchInterval: number | false = false) {
  const { isConnected } = useServerStatus();

  const gamesQuery = useQuery({
    queryFn: () => api.get<Game[]>("/games"),
    queryKey: ["games"],
    refetchInterval: (query) =>
      query.state.status === "error" ? SERVER_RETRY_INTERVAL_MS : refetchInterval,
  });

  const installedQuery = useQuery({
    enabled: isDesktop,
    queryFn: listInstalledGames,
    queryKey: ["installedGames"],
    refetchInterval: 30_000,
  });

  const installedGames = useMemo(
    () => installedQuery.data?.map((game) => installedGameToGame(game)) ?? NO_GAMES,
    [installedQuery.data],
  );

  const isOffline = isDesktop && (!isConnected || gamesQuery.isError);

  return {
    games: isOffline ? installedGames : (gamesQuery.data ?? NO_GAMES),
    isLoading: isOffline ? installedQuery.isLoading : gamesQuery.isLoading,
    isOffline,
  };
}
