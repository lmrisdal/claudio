import { useSearchParams } from "react-router";
import GamesTab from "../components/games-tab";
import ScanTab from "../components/scan-tab";
import SettingsTab from "../components/settings-tab";
import UsersTab from "../components/users-tab";

export default function Admin() {
  const [searchParameters, setSearchParameters] = useSearchParams();
  const validTabs = ["users", "games", "scan", "settings"] as const;
  type Tab = (typeof validTabs)[number];
  const tabParameter = searchParameters.get("tab") as Tab;
  const activeTab: Tab = validTabs.includes(tabParameter) ? tabParameter : "users";
  const setActiveTab = (tab: Tab) => setSearchParameters({ tab }, { replace: false });

  const tabs = [
    { id: "users" as const, label: "Users" },
    { id: "games" as const, label: "Games" },
    { id: "scan" as const, label: "Library Scan" },
    { id: "settings" as const, label: "Settings" },
  ];

  return (
    <main className="max-w-4xl mx-auto px-6 py-8 flex-1 w-full">
      <h1 className="font-display text-3xl font-bold text-heading text-text-primary mb-8">
        Admin Panel
      </h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-8 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${
              activeTab === tab.id
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text-secondary"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "users" && <UsersTab />}
      {activeTab === "games" && <GamesTab />}
      {activeTab === "scan" && <ScanTab />}
      {activeTab === "settings" && <SettingsTab />}
    </main>
  );
}
