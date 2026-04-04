import { createContext, useContext } from "react";

export interface ServerStatusState {
  isConnected: boolean;
}

export const ServerStatusContext = createContext<ServerStatusState>({
  isConnected: true,
});

export function useServerStatus() {
  return useContext(ServerStatusContext);
}
