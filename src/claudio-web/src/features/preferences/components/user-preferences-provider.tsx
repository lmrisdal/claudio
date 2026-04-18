import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, type ReactNode } from "react";
import { useAuth } from "../../auth/hooks/use-auth";
import { api } from "../../core/api/client";
import type { UserPreferences } from "../../core/types/models";
import { UserPreferencesContext } from "../hooks/user-preferences-context";

const DEFAULT_PREFERENCES: UserPreferences = {
  library: {
    platformOrder: [],
  },
};

function normalizePreferences(preferences?: UserPreferences | null): UserPreferences {
  return {
    library: {
      platformOrder: preferences?.library.platformOrder ?? [],
    },
  };
}

export default function UserPreferencesProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const queryKey = ["userPreferences", user?.id ?? 0];

  const preferencesQuery = useQuery({
    enabled: Boolean(user),
    queryFn: () => api.get<UserPreferences>("/preferences"),
    queryKey,
  });

  const savePreferencesMutation = useMutation({
    mutationFn: (next: UserPreferences) => api.put<UserPreferences>("/preferences", next),
    onError: (_error, _next, previous) => {
      if (previous) {
        queryClient.setQueryData(queryKey, previous);
      }
    },
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<UserPreferences>(queryKey);
      queryClient.setQueryData(queryKey, normalizePreferences(next));
      return previous;
    },
    onSuccess: (next) => {
      queryClient.setQueryData(queryKey, normalizePreferences(next));
    },
  });

  const preferences = normalizePreferences(preferencesQuery.data ?? DEFAULT_PREFERENCES);

  const updatePreferences = useCallback(
    (next: UserPreferences) => {
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

  return <UserPreferencesContext value={value}>{children}</UserPreferencesContext>;
}
