# sideshow — Backlog

Observations, requested changes and ideas from using the app. They're a record, not a
commitment: an item is built only when Evan picks it. New items go in **Inbox** first, then get
sorted into Next / Soon / Later by when they'd make sense. Milestones (M3, M4, M5…) are the ones in
[DESIGN.md §12](../DESIGN.md#12-milestones). When an item is done, delete it here and note it
under Status in [CLAUDE.md](../CLAUDE.md).

## Inbox

- **Moving and removing pushed time (2026-10-13, to flesh out together).** Move a session's
  CW entry to another ticket (e.g. something done under the WRIT that belongs on a client
  ticket), and delete or "remove from this ticket" so the CW entry goes too, in one or two
  steps. Today: deleting or merging a pushed session leaves its CW entry; changing the task's
  ticket and pushing Update… moves the entry (push.ts, "moved").
- **WRIT follow-ups (maybe).** A default work type for the WRIT's sessions (Internal Technical /
  Office?); archive last week's WRIT task once Evan closes its ticket in CW (after the timesheet).

- **DEV badge (Evan to pick up 2026-10-14).** So the dev server can't be mistaken for the live
  site. Detect it with Vite's `import.meta.env.DEV` (true only under `npm run dev`; the built app
  on the mini PC never is), not by port or host (the mini PC's LAN address :8081 is the real
  data). Proposed: an orange **DEV** pill after "sideshow" in the header (`--warn` token), and
  the tab title "sideshow · DEV". Optional: an orange-dot favicon. ~10 minutes.

- **Task description: decide what it is (Evan to look at next, 2026-10-13).** Today it's
  sideshow-only: New ticket… copies it into the ticket's initial description once, and after
  that nothing syncs either way. Recommended: keep it as private scratch space and say so
  (placeholder "Your notes on this task (stay in sideshow)"; New ticket… says it's copied once).
  Not syncing with CW's initial description: it's usually the client's own text (their email),
  the API sets it only at creation (after that it's the ticket's first note), and two-way sync
  needs conflict rules. Optional: on a linked task, the ticket's initial description read-only
  and collapsed ("Ticket description"), one extra lookup per ticket.

- **Fonts: picked 2026-10-12** (Unbounded for the header, Bricolage Grotesque for the rest),
  loaded from Google Fonts by one `<link>` in index.html and set as `--font-brand` / `--font` in
  styles.css. The tester stays under Settings › Experimental (`fonts.ts`, `fonts-sans.ts`,
  `FontSetting`), per device. Later: self-host the two fonts so the installed app has them
  offline, and drop the tester (and `.backdrop:has(> .dialog.settings)`) once settled.

- **Delete, the rest (2026-10-12).** Tasks without a ticket # can be deleted (Task details).
  Still to do: projects (proposed: their tasks and subprojects move up to the parent), tasks
  with a ticket or pushed time (warn; their CW entries stay), and notes once M8 Notes exist.
- **Ticket and project-ticket picker (2026-10-12, M5/M6), next.** See the
  Ticket search window and Track a CW project below.
- **Rich notes, follow-ups (2026-10-13).** Built: the editor, attachments, push to CW
  (DESIGN.md §7 "Rich notes", §10 "Attachments on push").
  - Check on the iPhone: ▶ New still raises the keyboard (the notes field is now an editor).
  - Pictures inside CW notes: CW's editor hosts them itself (`newinlineimages`); if there's a
    supported way to do the same, the note could show the picture instead of "*Attachment:*".
  - Uploads need a connection; a paste while offline could wait in the outbox (IndexedDB).
  - The editor made the app's script ~820 kB (256 kB gzipped); load it lazily if the phone
    feels slower to start.
  - Project descriptions are still plain text boxes.

- **Edit the profile in the app (later).** Fields, lists and the entry format from Settings,
  instead of editing the profile JSON in the repo.

Items marked **(?)** need a word from Evan on what was meant before building.

## Next — small, from daily use

- **Drag on the calendar with a finger (M3 leftover).** On touch screens the Day page's
  calendar only selects and scrolls. Add long-press to drag a block or its edges, and to sweep
  out new time, without breaking scrolling. Low priority: the phone is for capture.

## Soon — with the CW milestones (M4–M6)

- **Travel quick buttons (M5).** One tap to add a travel session / set the travel work type.
  Pin down: does it add a separate session, and with which work type(s) and default length?

- **Ticket search window (M5, larger).** A dense results window for finding the right ticket:
  search all open tickets at minimum, and closed ones too, since the work may belong to a
  closed ticket. Results offer **Track** (DESIGN.md §10, Tracked vs. findable). Ties in with
  §10 "suggest likely existing tickets". On desktop this may mean a more information-dense
  layout overall; design it before building.
- **Track a CW project (M6).** Search CW projects, track one, pick which of its tickets to
  track, with the template tickets (Project Coordination, Client Communication, In-house
  Preparation) preselected by name from the profile.
- **Sidebar (M6).** Now, Inbox, Projects, Tasks, then profile/integration views (Clients, CW
  Tickets, CW Projects). DESIGN.md §7, Surfaces 4.

## Later

- **Calendar beyond one day.** Work week and month views of the Day page's calendar, like
  Outlook / CW's weekly Time Sheet (DESIGN.md §7, Day calendar "Later").

- **Native apps (M9 and "later").** What it would take to make proper Android, iOS and
  Windows apps, with native gestures such as swipe-out menus. Windows is M9 (Tauri); write up
  the options (Tauri mobile, Capacitor, React Native) before committing.
