import type { ReactNode } from "react";

export default function GameSettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-4 border-b border-border p-5 last:border-b-0 sm:grid-cols-[1fr_1fr] sm:items-center sm:gap-8">
      <div>
        <h3 className="text-sm font-medium text-text-primary">{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">{description}</p>
      </div>
      {children}
    </div>
  );
}
