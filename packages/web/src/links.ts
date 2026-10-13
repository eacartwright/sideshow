// Links and pictures in notes: what hovering one says, and opening it (a new tab, so the app
// stays where it was). An attachment's link is /api/files/<id>/<name>: the tooltip shows the
// name, not the id.

export function linkTitle(href: string): string {
  const file = /^\/api\/files\/[^/]+\/([^?#]+)/.exec(href);
  if (file) {
    try {
      return `${decodeURIComponent(file[1]!)} (attachment)`;
    } catch {
      return "Attachment";
    }
  }
  return href;
}

export function openLink(href: string) {
  window.open(href, "_blank", "noopener,noreferrer");
}
