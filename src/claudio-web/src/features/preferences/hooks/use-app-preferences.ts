import { useContext } from "react";
import { AppPreferencesContext, type AppPreferencesContextValue } from "./app-preferences-context";

export function useAppPreferences(): AppPreferencesContextValue {
  const context = useContext(AppPreferencesContext);
  if (!context) {
    throw new Error("useAppPreferences must be used within AppPreferencesProvider");
  }
  return context;
}
