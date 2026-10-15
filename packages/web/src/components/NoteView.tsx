import { linkTitle, openLink } from "../links";
import { showPicture } from "./Lightbox";
import { noteHtml } from "../markdown";

/**
 * A note shown formatted, as the editor shows it, but not editable: lists, bold, links,
 * pictures as thumbnails. It sits inside a clickable session row: clicking a link opens it in a
 * new tab (a picture over the page) instead of opening the session; hovering one says where it
 * goes.
 */
export function NoteView({ markdown, className = "" }: { markdown: string; className?: string }) {
  return (
    <div
      className={`note-view rich-content ${className}`}
      dangerouslySetInnerHTML={{ __html: noteHtml(markdown) }}
      onMouseOver={(e) => {
        const el = (e.target as HTMLElement).closest("a, img");
        if (el instanceof HTMLAnchorElement && !el.title) el.title = linkTitle(el.getAttribute("href") ?? "");
        if (el instanceof HTMLImageElement && !el.title) el.title = `${linkTitle(el.getAttribute("src") ?? "")}: click to view`;
      }}
      onClick={(e) => {
        const el = (e.target as HTMLElement).closest("a, img");
        const href = el instanceof HTMLAnchorElement ? el.getAttribute("href") : el instanceof HTMLImageElement ? el.getAttribute("src") : null;
        if (!href) return;
        // Not the row's own click (which opens the session for editing).
        e.preventDefault();
        e.stopPropagation();
        if (el instanceof HTMLImageElement) showPicture(href, el.getAttribute("alt") ?? "");
        else openLink(href);
      }}
    />
  );
}
