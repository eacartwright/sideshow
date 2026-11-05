# sideshow — Backlog

Observations, requested changes and ideas from using the app. They're a record, not a
commitment: an item is built only when Evan picks it. New items go in **Inbox** first, then get
sorted into Next / Soon / Later by when they'd make sense. Milestones (M3, M4, M5…) are the ones in
[DESIGN.md §12](../DESIGN.md#12-milestones). When an item is done, delete it here and note it
under Status in [CLAUDE.md](../CLAUDE.md).

## Inbox

Dev notes of 2026-11-02 (🧪 on the live site), sorted here; each is marked with that date.
Folded into existing items: the ticket pickers, travel / GPS. (Those two, and the phone toolbar,
were built 2026-11-04.)
- **AI summary of an existing ticket (2026-11-02).** On a linked task, ✨ Summarize: fetch the
  ticket's description and notes from CW and have the AI model sum them up (where it stands,
  what's been tried, what's next). Same providers and settings as note cleanup (DESIGN.md
  §11); probably its own template in `server/ai-templates/`. Pin down: shown where (Task
  details?), kept or redone each time.
- **Running sessions in the Entries view (2026-11-02).** The list marks them ("running", built
  2026-11-04); the full table doesn't yet.
- **The running card on a phone, still crowded (2026-11-04).** Four rows of controls above the
  notes. Evan's words: "editing is close but things are messy and crowded". Worth looking at
  with him once he's used the new Start and Travel: maybe company + ticket on one line, with
  notes-to, WRIT and New entry folded away.
- **Dictation, live as you speak (2026-11-04, maybe).** Today's 🎙 gives the text when you stop.
  `gpt-live-transcribe` could show words as they come, at about four times the price. Only if
  waiting turns out to bother him.
- **Location, next steps (2026-11-04, maybe).** Addresses instead of coordinates (needs a geocoding
  service; decide what's sent where), a day's stamps on the calendar, and arrive/leave detection
  through iOS Shortcuts automations (M10).
- **Collapse pushed (2026-11-02).** On the Day page / Entries, a group whose sessions are all
  pushed starts collapsed, so what's left to do stands out. A group you open stays open.
- **More work types (2026-11-02).** Research & Development, Service Coordination, others. A
  profile edit (`profiles/veritaz-cw.json`), but each name must match a CW work type exactly
  or the push fails ("ConnectWise has no work type"); check CW's list and each one's billing.
- **Hover highlight (2026-11-02).** A hover state on rows and buttons: the task list, the
  header's buttons, and generally anything clickable. A token in styles.css (light + dark),
  only under `@media (hover: hover)` so the phone doesn't get sticky highlights.
- **Undo button in the header (2026-11-02).** Undo exists (Ctrl+Z anywhere; ↶ only on the Day
  page). Put ↶ in the header so it's in reach everywhere, phone included (icon-only there,
  like 🗓️). Disabled when there's nothing to undo; the title says what it would undo.
- **Plan time ahead from Entries (2026-11-02, the "preset tickets upcoming work" note).** Prep
  the day ahead without starting a timer: from the Entries / Day page, make a new task (ticket
  # optional), and put time on it, e.g. tomorrow's travel, then adjust it on the day if it
  differs. Today "+ Add time" exists per group on the Day page (and future times are allowed),
  but a new task can only come from ▶ New or the Inbox. Pin down: does planned time look
  different until the day comes (so it isn't pushed early), and does it ever need New ticket…
  right there.
- **Ticket note templates (2026-11-02, the "template tickets" note; Evan to bring examples).**
  Preset text for the notes field (a checklist or skeleton per kind of work). Waiting on
  Evan's examples before designing. Maybe the same Markdown-file format as
  `server/ai-templates/`.
- **Wrapper entry: fill the day (2026-11-02, the "auto wrapper" note).** What Evan does by
  hand in CW today: one entry on **this week's WRIT** spanning the workday (say 8:00–17:00),
  work type **Admin** (exists in CW; not in the profile's list yet), with a **deduct** so it
  adds only the missing part. Note: "Wrapper for Mon 11/2/2026". Settled with Evan:
  - Target = the workday minus the **real lunch** (asked each time, default 1 h), and never
    under 8.00 h; over 8 is fine. Wrapper = max(workday − lunch, 8) − logged; none if ≤ 0.
    Deduct = workday − wrapper. E.g. 9 h day, 1 h lunch, 7.45 logged: wrapper 0.55, deduct
    8.45 (Evan's example); 0.5 h lunch: wrapper 1.05, a day of 8.50 h.
  - Always the WRIT.
  - Still open: billing (Do Not Bill?); the day's start / end and the 8 h minimum as
    settings; adding Admin to the profile (the server only seeds empty lists, so on the live
    site it's added in the app or by a fill like the work-type defaults).
  - Proposed: a button on the Day page ("Wrap up the day…", a preview before it pushes), not
    automatic; redoing it after more time is added updates the same entry.
  - Overlap: the wrapper deliberately overlaps the day's real entries, so the planned overlap
    warnings (Day page improvements, item 1) must skip it.

- **A ticket per session, for CW projects (2026-10-19, Evan; proposed, waiting on his go).**
  A project job is one piece of work but several tickets (travel, coordination / client
  communication, onsite delivery). Proposed: a task can link a CW project (#302) instead of a
  ticket; each session then gets a **Ticket** dropdown of that project's tickets (fetched from
  CW), carried over to the next session like the work type, and the push uses the session's
  ticket. On the Day page the session rows show their ticket in the Ticket # column, which is
  blank on session rows today. Maybe: a work type picks the matching template ticket (Travel →
  the travel ticket). Folds in "Track a CW project (M6)" below. **Move to…** (built
  2026-10-19) already covers one-off moves between tasks.
- **Two-way sync of pushed entries (2026-10-19, Evan asked; proposed).** Each pushed session
  has its CW entry id (`ext.cw.entryId`). Proposed: keep a fingerprint of what was pushed;
  when the entries are on screen (Entries page, a group's ↻, Task details) fetch them and
  compare (the deleted-in-CW check, `checkPushed`, already runs then). Changed in CW only →
  take CW's times, notes, deduct, work type, billing, still entered, with a toast. Changed in
  both → "⚠ changed in both": keep mine (Update…) or take CW's. Not every entry ever, only
  what's being looked at. Care with notes holding attachments (CW has "*Attachment: name*").
- **CW sites (2026-10-14, Evan noticed; to think through).** Some companies have several sites
  in CW. A time entry is on a ticket, and the ticket already has the site, so pushing needs
  nothing. Where it matters: **New ticket…** (CW uses the company's default site; offer a site
  picker when the company has more than one: `GET /company/companies/{id}/sites`), and maybe
  showing the ticket's site on the Day page (Evan's thought: the entries screen). Check what
  the WRIT and onsite work types expect before building.
- **Denser everywhere, next steps (2026-10-14).** First pass done (36 px buttons, 34 px fields,
  running card trimmed). Look at the Day page rows, Task details and the header the same way.

- **Moving and removing pushed time (2026-10-13, to flesh out together).** Move a session's
  CW entry to another ticket (e.g. something done under the WRIT that belongs on a client
  ticket), and delete or "remove from this ticket" so the CW entry goes too, in one or two
  steps. Today: deleting or merging a pushed session leaves its CW entry; changing the task's
  ticket and pushing Update… moves the entry (push.ts, "moved"), and so does **Move to…**
  (2026-10-19) a pushed session onto a task with another ticket, then Update….
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
- **Ticket picker: built 2026-11-04** (DESIGN.md §10). Left: Track a CW project below.
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
