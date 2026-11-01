import { useRouteError } from "react-router";

export default function RouteError() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : "An unexpected error occurred.";

  return (
    <main
      role="alert"
      className="flex-1 flex flex-col items-center justify-center gap-3 px-6 py-24 text-center"
    >
      <h1 className="font-display text-xl font-semibold text-text-primary">Something went wrong</h1>
      <p className="max-w-md text-sm text-text-muted break-words">{message}</p>
      <button
        type="button"
        autoFocus
        onClick={() => globalThis.location.reload()}
        className="mt-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition hover:bg-accent-hover outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg)"
      >
        Reload
      </button>
    </main>
  );
}
