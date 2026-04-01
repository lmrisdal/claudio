import { useAuth } from "../hooks/use-auth";

export default function AccountTab() {
  const { user } = useAuth();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
        <span className="text-white/50">Username</span>
        <span className="font-mono text-white">{user?.username}</span>
        <span className="text-white/50">Role</span>
        <span>
          <span
            className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${
              user?.role === "admin"
                ? "bg-accent-dim text-accent"
                : "bg-white/8 text-white/70 ring-1 ring-white/10"
            }`}
          >
            {user?.role}
          </span>
        </span>
        <span className="text-white/50">Member since</span>
        <span className="text-white">
          {user?.createdAt
            ? new Date(user.createdAt).toLocaleDateString()
            : "—"}
        </span>
      </div>
    </div>
  );
}
