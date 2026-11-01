export function getConnectionErrorMessage(status?: number | null): string {
  if (typeof status === "number" && status >= 200 && status < 300) {
    return "The URL responded, but it doesn't look like a running Claudio server.";
  }

  if (typeof status === "number") {
    return `Server responded with ${status}.`;
  }

  return "Could not connect. Check the URL and make sure the server is running.";
}
