export function updatedPanelUrl(
  href: string,
  installed: string,
  running: string | undefined,
): string | null {
  if (!running || running === installed) return null;
  const url = new URL(href);
  if (url.searchParams.get("gym-version") === running) return null;
  url.searchParams.set("gym-version", running);
  return url.href;
}
