export function getConnectionErrorMessage(status?: number | null): string {
  if (typeof status === "number") {
    return `Server responded with ${status}.`;
  }

  return "Could not connect. Check the URL and make sure the server is running.";
}
