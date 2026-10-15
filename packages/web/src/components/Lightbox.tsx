import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { linkTitle } from "../links";

// A picture from a note, shown over the page instead of in a new window (which the installed
// app opens as a separate window). Fitted to the screen, small ones enlarged up to 2×; a click
// zooms in further where you clicked (scroll to look around), another fits it again. Esc, ✕ or
// a click beside it closes it. One at a time, opened from anywhere with showPicture().

let current: { src: string; alt: string } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function showPicture(src: string, alt = "") {
  current = { src, alt };
  emit();
}

function closePicture() {
  current = null;
  emit();
}

export function Lightbox() {
  const pic = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
  if (!pic) return null;
  return <Picture key={pic.src} src={pic.src} alt={pic.alt} />;
}

function Picture({ src, alt }: { src: string; alt: string }) {
  const backdrop = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [box, setBox] = useState({ w: window.innerWidth, h: window.innerHeight });
  // Where to scroll once zoomed: the clicked point stays under the pointer.
  const anchor = useRef<{ fx: number; fy: number; x: number; y: number } | null>(null);

  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // Only the top layer closes (this can open over a dialog).
      const all = document.querySelectorAll(".backdrop");
      if (e.key === "Escape" && all[all.length - 1] === backdrop.current) closePicture();
    };
    const measure = () => {
      const el = body.current;
      if (el) setBox({ w: el.clientWidth, h: el.clientHeight });
    };
    measure();
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", measure);
    };
  }, []);

  const pad = 16;
  const fit = natural ? Math.min((box.w - 2 * pad) / natural.w, (box.h - 2 * pad) / natural.h, 2) : 1;
  const scale = zoomed ? Math.max(1, fit * 2) : fit;
  const size = natural ? { width: Math.round(natural.w * scale), height: Math.round(natural.h * scale) } : undefined;
  const canZoom = !!natural && Math.max(1, fit * 2) > fit * 1.05;

  useEffect(() => {
    const el = body.current;
    const a = anchor.current;
    if (!el || !a || !size) return;
    anchor.current = null;
    el.scrollLeft = a.fx * size.width + pad - a.x;
    el.scrollTop = a.fy * size.height + pad - a.y;
  });

  const name = alt || linkTitle(src).replace(/ \(attachment\)$/, "");
  return (
    <div className="backdrop lightbox" ref={backdrop} role="dialog" aria-modal="true" aria-label={name}>
      <div className="lightbox-bar">
        <span className="lightbox-name">{name}</span>
        <a className="btn subtle" href={src} target="_blank" rel="noreferrer" title="Open it on its own (a new window in the installed app)">
          ↗ Open
        </a>
        <button className="btn icon" ref={close} onClick={closePicture} aria-label="Close">
          ✕
        </button>
      </div>
      <div
        className={`lightbox-body ${zoomed ? "zoomed" : ""}`}
        ref={body}
        onMouseDown={(e) => e.target === e.currentTarget && closePicture()}
      >
        <img
          src={src}
          alt={name}
          style={size}
          className={canZoom ? (zoomed ? "zoom-out" : "zoom-in") : ""}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          onClick={(e) => {
            if (!canZoom) return;
            if (!zoomed) {
              const r = e.currentTarget.getBoundingClientRect();
              const b = body.current!.getBoundingClientRect();
              anchor.current = { fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height, x: e.clientX - b.left, y: e.clientY - b.top };
            }
            setZoomed(!zoomed);
          }}
        />
      </div>
    </div>
  );
}
