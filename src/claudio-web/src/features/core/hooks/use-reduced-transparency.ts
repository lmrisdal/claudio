import { useEffect, useSyncExternalStore } from "react";
import { isReducedTransparencyEnabled, subscribeToReducedTransparency } from "../utils/preferences";

export function useReducedTransparency() {
  const reducedTransparency = useSyncExternalStore(
    subscribeToReducedTransparency,
    isReducedTransparencyEnabled,
    () => false,
  );

  useEffect(() => {
    document.documentElement.classList.toggle("reduce-transparency", reducedTransparency);
  }, [reducedTransparency]);

  return reducedTransparency;
}
