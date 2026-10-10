# sideshow — Backlog

Observations, requested changes and ideas from using the app. They're a record, not a
commitment: an item is built only when Evan picks it. New items go in **Inbox** first, then get
sorted into Next / Soon / Later by when they'd make sense. Milestones (M1.5, M5, M6…) are the ones in
[DESIGN.md §12](../DESIGN.md#12-milestones). When an item is done, delete it here and note it
under Status in [CLAUDE.md](../CLAUDE.md).

## Inbox

- **Edit the profile in the app (later).** Fields, lists and the entry format from Settings,
  instead of editing the profile JSON in the repo.

Items marked **(?)** need a word from Evan on what was meant before building.

## Next — small, from daily use

Nothing waiting.

## Soon — with M5–M8 (projects & profiles, then CW)

- **"WRIT" quick button (M6).** One tap to put a task on the catch-all ticket(s) instead of
  looking up a ticket number. Needs the catch-all ticket number(s) stored in Settings.
- **Travel quick buttons (M6).** One tap to add a travel session / set the travel work type.
  Pin down: does it add a separate session, and with which work type(s) and default length?
- **Bulk push (M8).** Push all of a task's (or a day's) unentered sessions to CW at once from
  Time entries, rather than one by one.
- **Ticket search window (M6, larger).** A dense results window for finding the right ticket:
  search all open tickets at minimum, and closed ones too, since the work may belong to a
  closed ticket. Results offer **Track** (DESIGN.md §10, Tracked vs. findable). Ties in with
  §10 "suggest likely existing tickets". On desktop this may mean a more information-dense
  layout overall; design it before building.
- **Track a CW project (M7).** Search CW projects, track one, pick which of its tickets to
  track, with the template tickets (Project Coordination, Client Communication, In-house
  Preparation) preselected by name from the profile.
- **Sidebar (M7).** Now, Inbox, Projects, Tasks, then profile/integration views (Clients, CW
  Tickets, CW Projects). DESIGN.md §7, Surfaces 4.

## Later

- **Native apps (M3 and "later").** What it would take to make proper Android, iOS and
  Windows apps, with native gestures such as swipe-out menus. Windows is M3 (Tauri); write up
  the options (Tauri mobile, Capacitor, React Native) before committing.
