import { useQuery } from "@tanstack/react-query";
import { api } from "../../core/api/client";
import SettingsForm, { type AdminConfig } from "./SettingsForm";

export default function SettingsTab() {
  const { data: config, isLoading } = useQuery({
    queryKey: ["adminConfig"],
    queryFn: () => api.get<AdminConfig>("/admin/config"),
  });

  if (isLoading || !config) {
    return <p className="text-sm text-text-muted">Loading settings…</p>;
  }

  return <SettingsForm initialConfig={config} />;
}
