import { createContext, useContext } from "react";

export const SERVER_RETRY_INTERVAL_MS = 5000;

export interface ServerStatusState {
  isConnected: boolean;
  refresh: () => Promise<void>;
}

export const ServerStatusContext = createContext<ServerStatusState>({
  isConnected: true,
  refresh: async () => {},
});

export function useServerStatus() {
  return useContext(ServerStatusContext);
}
