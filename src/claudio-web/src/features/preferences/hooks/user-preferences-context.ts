import { createContext } from "react";
import type { UserPreferences } from "../../core/types/models";

export interface UserPreferencesContextValue {
  isLoading: boolean;
  isSaving: boolean;
  preferences: UserPreferences;
  updatePreferences: (next: UserPreferences) => void;
  setPlatformOrder: (platformOrder: string[]) => void;
}

export const UserPreferencesContext = createContext<UserPreferencesContextValue | null>(null);
