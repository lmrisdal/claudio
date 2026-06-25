import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, type ReactNode } from "react";
import { api } from "../../core/api/client";
import type { AppPreferences } from "../../core/types/models";
import { AppPreferencesContext } from "../hooks/app-preferences-context";

const DEFAULT_PREFERENCES: AppPreferences = {
  library: {
    platformOrder: [],
  },
};

function normalizePreferences(preferences?: AppPreferences | null): AppPreferences {
  return {
    library: {
      platformOrder: preferences?.library.platformOrder ?? [],
    },
  };
}

export default function AppPreferencesProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const queryKey = ["preferences"];

  const preferencesQuery = useQuery({
    queryFn: () => api.get<AppPreferences>("/preferences"),
    queryKey,
  });

  const savePreferencesMutation = useMutation({
    mutationFn: (next: AppPreferences) => api.put<AppPreferences>("/preferences", next),
    onError: (_error, _next, previous) => {
      if (previous) {
        queryClient.setQueryData(queryKey, previous);
      }
    },
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<AppPreferences>(queryKey);
      queryClient.setQueryData(queryKey, normalizePreferences(next));
      return previous;
    },
    onSuccess: (next) => {
      queryClient.setQueryData(queryKey, normalizePreferences(next));
    },
  });

  const preferences = normalizePreferences(preferencesQuery.data ?? DEFAULT_PREFERENCES);

  const updatePreferences = useCallback(
    (next: AppPreferences) => {
      savePreferencesMutation.mutate(normalizePreferences(next));
    },
    [savePreferencesMutation],
  );

  const setPlatformOrder = useCallback(
    (platformOrder: string[]) => {
      updatePreferences({
        library: {
          platformOrder,
        },
      });
    },
    [updatePreferences],
  );

  const value = useMemo(
    () => ({
      isLoading: preferencesQuery.isLoading,
      isSaving: savePreferencesMutation.isPending,
      preferences,
      updatePreferences,
      setPlatformOrder,
    }),
    [
      preferences,
      preferencesQuery.isLoading,
      savePreferencesMutation.isPending,
      setPlatformOrder,
      updatePreferences,
    ],
  );

  return <AppPreferencesContext value={value}>{children}</AppPreferencesContext>;
}
