# sideshow — Backlog

Observations, requested changes and ideas from using the app. They're a record, not a
commitment: an item is built only when Evan picks it. New items go in **Inbox** first, then get
sorted into Next / Soon / Later by when they'd make sense. Milestones (M3, M4, M5…) are the ones in
[DESIGN.md §12](../DESIGN.md#12-milestones). When an item is done, delete it here and note it
under Status in [CLAUDE.md](../CLAUDE.md).

## Inbox

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
- **Rich text / Markdown in notes (2026-10-12).** Simple, like CW's own editor: toolbar
  B / I / U, bulleted and numbered lists, attach, link, image; stored as Markdown (CW notes
  are Markdown, and M8 Notes were always meant to be). Constraint: the running card's notes box must stay a
  synchronously focusable field (iPhone keyboard).
- **Attachments, incl. pasting screenshots into notes (2026-10-12).** Stored by the server
  (and in its backups). Pushed to the CW ticket with the entry (as ticket documents, or inline
  in the note if CW's Markdown takes images).

- **Edit the profile in the app (later).** Fields, lists and the entry format from Settings,
  instead of editing the profile JSON in the repo.

Items marked **(?)** need a word from Evan on what was meant before building.

## Next — small, from daily use

- **Drag on the calendar with a finger (M3 leftover).** On touch screens the Day page's
  calendar only selects and scrolls. Add long-press to drag a block or its edges, and to sweep
  out new time, without breaking scrolling. Low priority: the phone is for capture.

## Soon — with the CW milestones (M4–M6)

- **"WRIT" quick button (M5).** One tap to put a task on the catch-all ticket(s) instead of
  looking up a ticket number. Needs the catch-all ticket number(s) stored in Settings.
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
