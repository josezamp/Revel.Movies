export function LinkThumbnail({ url }: { url: string }) {
  let host = url
  try { host = new URL(url).hostname } catch { /* Keep the address visible if metadata is incomplete. */ }
  return <span className="library-link-preview" aria-hidden="true">
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="24" cy="24" r="18" />
      <ellipse cx="24" cy="24" rx="8" ry="18" /><path d="M6 24h36M10 13h28M10 35h28" /></svg>
    <span>{host}</span>
  </span>
}
