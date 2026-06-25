import { createContext } from "react";
import type { AppPreferences } from "../../core/types/models";

export interface AppPreferencesContextValue {
  isLoading: boolean;
  isSaving: boolean;
  preferences: AppPreferences;
  updatePreferences: (next: AppPreferences) => void;
  setPlatformOrder: (platformOrder: string[]) => void;
}

export const AppPreferencesContext = createContext<AppPreferencesContextValue | null>(null);
