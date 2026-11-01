import type { ComponentProps } from "react";

export default function StyledSelect({ className = "", ...props }: ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        {...props}
        className={`w-full appearance-none truncate rounded-lg border border-border bg-surface-raised px-3 py-2.5 pr-10 text-sm font-medium text-text-primary transition-colors hover:border-text-muted focus:outline-none focus:ring-2 focus:ring-focus-ring ${className}`}
      />
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-text-secondary"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
      >
        <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
