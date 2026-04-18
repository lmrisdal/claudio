import { useContext } from "react";
import {
  UserPreferencesContext,
  type UserPreferencesContextValue,
} from "./user-preferences-context";

export function useUserPreferences(): UserPreferencesContextValue {
  const context = useContext(UserPreferencesContext);
  if (!context) {
    throw new Error("useUserPreferences must be used within UserPreferencesProvider");
  }
  return context;
}
