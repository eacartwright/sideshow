# sideshow — Design

*v1.1 · 2026-10-10 · living document, edit freely*

## 1. Purpose

sideshow answers **"what was I doing all day?"** It's a personal work log, and the whole app
serves two goals:

1. **Frictionless start/stop.** Starting, switching and resuming work should feel like a
   stopwatch, on desktop and on the phone.
2. **Frictionless capture.** Getting information about each stretch of time in, while it happens
   or right after, should take as little effort as possible.

Everything else is secondary. The app is also the **inbox** for work I haven't started yet, and
(later) quick **Notes**.

Longer term it's a **whole work-task system**: keeping track of tasks and projects, scheduling
them, not losing any, and tracking the time spent on them. It's task-oriented, not
ticket-oriented, and not specific to MSPs.

The core is **job-agnostic and deliberately basic**. Everything specific to the current job,
such as tickets, clients, work types and billing, is layered on top as a **profile** (the fields)
and an **integration** (the ConnectWise API) (§4). The next job gets the same core with a
different profile and integration, or none at all.

**It works beside the company's tools, not instead of them.** I'll always have to work directly
in many apps (the PSA, RMM, email, chat). This is my own place for keeping track of all of it,
for me personally: my own show beside the company's main one. Hence the name,
**sideshow** (always lowercase; called fieldtime until 2026-10-10).

sideshow is where work **starts**. Creating a ticket or finding the right one in another system
must never be a prerequisite for recording work.

### The problem, concretely (current job)

A normal morning: start updating a ticket → coworker needs help on his project (training /
project coordination on *his* project ticket) → 15 min of calendar/email/chat review (weekly
recurring internal ticket) → phone call, remote-control troubleshooting → back to the coworker
→ back to the ticket from the start of the day.

Every one of those becomes a separate ConnectWise time entry with its own client, ticket, work
type, billable flag, date, start/end time and notes. Today that means combing CW for the right
ticket up front, then re-typing times and running notes through AI by hand afterwards.

## 2. Principles (in priority order)

1. **Switching is one action.** Starting something new stops whatever was running, unless you
   start it *alongside*. Returning to earlier work is also one action.
2. **Capture now, classify later.** A new task needs only a title. Everything else can be filled
   in afterwards.
3. **Never lose time or notes.** A flaky connection, a closed tab or a dead battery must not drop
   a start/stop or a note.
4. **What's running is the same everywhere.** Running state is shared, not per-device. Several
   tasks can run at once (work is organic, and CW allows overlapping entries).
5. **The data outlives any service.** I host it myself, it's a plain file I can back up, and no
   vendor can pause or delete it.
6. **The core stays generic, and profiles and integrations are optional.** Remove the CW
   integration and the app still fully works; remove the profile too and it's still a complete
   task and time tracker.
7. **Desktop for working the day, phone for capture.** About 90% of use is at a desktop or
   laptop. The phone is for starting, pausing and stopping, notes and quick fields. Desktop
   views use the full width (tables, the calendar, the keyboard) and are never pared down to fit
   the phone. Every feature should still *work* on the phone where it reasonably can, but where
   the two conflict, the layouts diverge by screen width instead of the desktop compromising.

## 3. Non-goals

- Multiple users, sharing, teams. It's just me.
- Personal tasks (Todoist stays for those).
- Replacing Obsidian. sideshow notes are quick, work-scoped and grouped by client. Deep
  reference material stays in the vault.
- Full project management: no subtasks, dependencies or Gantt charts.
- Billing-grade rounding. Employers apply their own afterwards.

## 4. Layers: core, profile, integration

| | **Core** (code, always on) | **Profile** (data, one JSON file) | **Integration** (code, optional) |
|---|---|---|---|
| What it is | The app itself, for any job | The fields a job needs | A connection to an external system |
| Examples | Projects, tasks, sessions, notes, inbox, schedule, Now stack, day report, entry sheet, export | Client, Ticket #, Assigned to, Work Type, Billing (Billable / Do Not Bill / No Charge) | CW: search and track tickets/projects, ticket lookup, list sync, push time entries |
| Without it | — | Plain task and time tracker | Profile fields filled in by hand; copy-to-clipboard still works |

**The core** is complete on its own: projects (§5), tasks, sessions with start, end, deduct and
notes, the inbox, scheduling, the day report, the Time entries sheet with click-to-copy, and
plain-text/CSV export. It has no idea what a ticket, client, work type or billable flag is.
Nothing switches core features on or off.

**A profile** declares the extra fields a job needs, and only those. **A field the profile
doesn't list doesn't exist** (an inclusion list, not a list of on/off flags). One profile is
active at a time. A profile is just data, so a job with no API access still gets its fields and
its entry format without writing code.

```json
{
  "name": "Veritaz / ConnectWise",
  "fields": [
    { "key": "client",   "label": "Client",      "on": "task",    "type": "list", "list": "clients", "groupBy": true },
    { "key": "ticket",   "label": "Ticket #",    "on": "task",    "type": "text" },
    { "key": "assignee", "label": "Assigned to", "on": "task",    "type": "text" },
    { "key": "workType", "label": "Work Type",   "on": "session", "type": "list", "list": "workTypes" },
    { "key": "billing",  "label": "Billing",     "on": "session", "type": "choice",
      "options": ["Billable", "Do Not Bill", "No Charge"] }
  ],
  "lists": { "workTypes": [{ "name": "Remote - Business Hours", "defaults": { "billing": "Billable" } }, "…"] },
  "entryFormat": { "date": "MM/DD/YYYY", "time": "h:mm A", "hours": "decimal",
                   "fields": ["date", "start", "end", "hours", "workType", "billing", "notes", "ticket"] }
}
```

- **Field types** (kept small): `text`, `choice` (fixed options), `list` (a managed list that can
  be edited in the app and synced by an integration), `bool`.
- **Where values live**: a per-record `fields` JSON blob keyed by `key`, on tasks and sessions.
  The core schema never changes when a profile changes.
- **Switching profiles keeps data.** Values stay in the blob, hidden, and reappear if the
  profile comes back (principle 5). List items are never deleted by a sync, only archived, so
  past sessions never point at nothing.
- **`groupBy`** gives a `list` field its own sidebar view and a page per value (the Client page,
  §5). Another job might group by department, or not at all.
- **List item `defaults`**: choosing an item sets the fields its defaults name (a work type sets
  Billing), unless the same change sets them itself; Billing can still be changed afterwards.
  The profile supplies them until an integration does (M5). When the profile's defaults
  change, records that use the item but lack the field get it once (server startup).
  The real profile is `packages/server/profiles/veritaz-cw.json`; this example is trimmed.
- **`entryFormat`** drives the Time entries sheet: which fields are shown and copied, and how
  dates, times and hours are written. Every PSA asks for roughly the same things.

**An integration** connects profile fields and core records to an external system (§10). It
maps the external system's entities onto the core's, syncs `list` fields, offers external
**search sources**, and adds actions (look up, track, push). Records it touches carry a generic
link, `{integration, externalId}`; the core never stores anything else about the external system.

*Rest of this document uses the current job's labels (Client, Work Type) for readability.*

## 5. Core concepts

```
Project ─┬─< Project (any depth)
         └─< Task ─< Session

Profile fields (fields blob)   Client, Ticket #, Assigned to   on tasks
                               Work Type, Billing              on sessions
```

### Project
A group of tasks and other projects that belong together. Optional: a task needn't be in one.

| Field | Notes |
|---|---|
| `title` | Required. |
| `parentId` | The project it sits in, or none. **Any depth** in the data; the UI shows one level until more is needed. |
| `description` | Optional context. |
| `status` | `open` · `done` · `archived`. |

A project is whatever I want to group: a handful of loose tasks, or several CW projects under one
heading ("Acme network refresh" holding loose tasks plus the CW project "Acme – Firewall
Replacement"). An integration can **link** a project to an external one (§10); it's still an
ordinary project, and every view, timer and report treats it the same.

### Three kinds of notes (keep them distinct)

| Kind | Lives on | What it's for | Example |
|---|---|---|---|
| **Session notes** | Session | What I did in *this* stretch of time. Becomes the time entry note (raw → AI cleanup → push). **The main one.** | "- rebooted FW, - firmware 7.2.3, - called ISP" |
| **Task description** | Task | Optional context about the work as a whole. | "Replace firewall at main office; ISP contact is…" |
| **Notes** | Itself, a project, or (with CW) a client | Quick jottings that aren't tasks *yet*. Turned into tasks afterwards. (M8.) | "FD1 printer not working. Wifi slow." |

### Task
A piece of work. At this job it's often a CW ticket or project ticket, but the core only knows
it as a task.

| Field | Notes |
|---|---|
| `title` | Optional at start. If blank, the first line of the first session's notes is shown, or "Untitled · 10:42". |
| `projectId` | The project it belongs to, or none. |
| `fields` | Profile field values (Client, Ticket #, Assigned to…). |
| `location` | Free text. Tapping it opens Maps. |
| `links[]` | URLs (docs, RMM, vendor portals, ticket URL…). |
| `doDate` / `dueDate` | When I intend to work on it / when it must be done. |
| `description` | Optional context (see above). Low-prominence in the UI. |
| `status` | `open` · `done` · `archived`. Whether it's running is *derived*, never stored here. |
| `deleted` | **Delete** in Task details (after "Are you sure…?"), only while the task has no ticket # (nothing in CW points at it): a tombstone (`task.delete` op) that stops it and takes its sessions with it (`deletedWithTask`), with Undo, which brings back exactly those. |

A task can have **any number of sessions over any number of days**. If you come back to a piece
of work, start the same task again.

### Inbox
**Open tasks that have never been started.** This is the catch-all for "client tacked on two
new issues while I'm on site" or "remember to follow up with X." Capture them with **New for
later**, optionally under a project or client. Starting one moves it out of the inbox.

### Session
One stint of work on a task, from start to stop. **One session = one time entry** in whatever
system takes them (at this job, CW entries carry their own start and end time).

| Field | Notes |
|---|---|
| `start` | Set automatically. Editable with the time picker (§7). |
| `end` | `null` while running. Editable. |
| `deduct` | Optional minutes subtracted (e.g. lunch), mainly for after-the-fact sessions. |
| `notes` | Stream-of-consciousness notes. Dictation works here. **Markdown**, edited formatted (below). |
| `fields` | Profile field values (Work Type, Billing…). Inherited from the task's previous session. |
| `enteredAt` | When it was marked as entered into the external system (core: "exported"). |

Derived: **duration** = end − start − deduct.

- **Continuation rule**: a session with empty notes exports as *"Continuation of previous work"*
  and inherits the previous session's field values.
- **Midnight rule**: a session crossing midnight is split at 00:00, so every session belongs to
  exactly one day.
- **Manual sessions**: add a session after the fact without having run a timer.
- **Blips are discarded**: a session under 30 seconds with no notes is dropped when it stops,
  unless it's the task's only session. Tapping the wrong task doesn't leave junk behind.
- **Resume, don't fragment**: continuing a task within 10 minutes of its last session ending
  reopens that session instead of starting a new one, so bouncing between tasks doesn't produce a
  pile of tiny entries. (Both thresholds are **Settings** (⚙ in the header), synced so every device
  and the server apply the same rule: discard under Off/10/30/60/120 s, default 30 s; resume within
  Off/2/5/10/15/30/60 min, default 10 min. Stored as `state.settings`, changed with the
  `settings.update` op.)
- **Merge**: in task details, tap one session and then another. Everything between them is
  selected. Merging keeps the earliest start and the latest end, and joins the notes (empty
  "continuation" notes are skipped). Merges are same-day only, since each CW entry is for one day.

### Rich notes and attachments (2026-10-13)

Session notes and task descriptions are edited **formatted** and stored as **Markdown**
(`web/src/markdown.ts`, `RichNotes.tsx`, TipTap). The toolbar matches CW's: **B / I / U**,
bulleted and numbered lists, attach a file, link, add a picture (on a phone the running card's
toolbar shows only while typing there). Underline is stored as `++text++`.

- **Old plain notes stay as they are**: a single line break is a line break both ways (read with
  `breaks`, written as a bare "
"), so opening and saving a plain note changes nothing.
- **Pasting a screenshot** (or dropping a file, or the 📎 / picture buttons) uploads it to the
  server (`POST /api/files`, up to 25 MB; needs a connection, not queued offline). Pictures show
  in the note (`![name](/api/files/<id>/<name>)`), other files as a link. A pasted screenshot is
  named `screenshot-YYYY-MM-DD-HHMMSS.png`.
- Files live in `data/files/` beside the database (`FileStore`, table `files`), are served
  back with their type (SVG, HTML and the like only as downloads), and are copied to the
  backup folder's `files/` hourly, never pruned.
- Where a note is previewed (Task details' session list, earlier sessions on the running card) it
  shows **formatted** (`NoteView`: the editor's schema to HTML, links checked; pictures as
  thumbnails). Clicking a link there opens it in a new tab (a picture full size), not the
  session; in the editor a click edits and **Ctrl+click** opens. Hovering a link shows where it
  goes (an attachment: its file name). Where notes must be one line of text (titles from
  notes, tooltips, the push preview) they go through `plainNote` (shared): marks dropped,
  pictures and files as "[name]".

### Notes (M8)
Quick markdown pages of jottings that aren't tasks *yet*: the "they mentioned ABC and DEF on the
call" moment, where you write it down now and turn it into tasks after the call (or after the
next interruption). Each line gets a **→ task** action that creates an inbox task from the
line's text. The editor renders rich text but stores plain markdown. *Maybe:* mirror Notes into
the Obsidian Work vault.

Notes are **core**: a note stands alone or sits on a project. With the CW profile and
integration, a note can also be **tied to a client** (the profile's `groupBy` field, so through
the client mapping its CW company): it shows on that client's page, is one tap from anywhere
the client appears, and its → task lines land under that client.

Until M8, the Inbox covers the same need: quickly add unstarted tasks under the client.

The **Client page** shows everything for that client in one place: open tasks, inbox items,
recent sessions (and later the Notes tied to it). This is the screen for "I'm at XYZ, open the app,
select XYZ." In general terms it's the page for one value of a profile's `groupBy` field (§4);
with no such field there's no Client page.

### Work type list (CW profile)

Synced from CW at M5; until then, seeded from the profile:

Remote - Business Hours · Onsite - Business Hours · In-house - Business Hours · Office ·
Internal Meeting · Internal Technical · Communications · Project Coordination ·
SALES - Quoting · Travel - To Client · Travel - From Client · Training - Providing

With no profile, sessions have no work type at all.

## 6. The one invariant

> **Each task has at most one open session.** Several tasks may be running at once.

Starting a task comes in two modes:
- **Switch** (default): close every other open session at time *t* (those tasks become
  **paused**, see below), then start this one at the same *t*.
- **Alongside**: start this one and leave the others running.

The reducer enforces this on the server, inside a transaction, and it's covered by tests. v1
kept three copies of "what's running," and they drifted apart. Here there is only one.

## 7. Interaction design

### The core flow

1. **Press ▶.** The exact date/time is recorded, a new task starts, and a **note field opens with
   the cursor in it**. No title or client is needed yet.
2. **Type what you're doing** (desk keyboard, phone, dictation). Leave it running while you
   work. Come back and add to it whenever you can. Notes save as you type.
3. **Pivot: press ▶ again.** The current session stops at that instant, a new task starts, and a
   fresh empty note field opens.
4. **Return to earlier work: find it and press its ▶.** It might be three tasks back, or from
   yesterday. A new session starts on that task with its own empty note (or the last one
   reopens, if it ended within 10 minutes). If you never type in it, it counts as
   "continuation of previous work."
5. **Juggling? Start it alongside.** Waiting on a reboot while helping a coworker: both run, as
   stacked cards, with the most recently started on top.
6. **Fill in the rest whenever.** Title, client and work type can be added during the work, or
   later from the Day page.

### The verbs

| Verb | Effect |
|---|---|
| **▶ New** | Start a new task now, note field focused, stopping whatever's running. *The primary button everywhere.* |
| **▶ Continue** | Start (or resume) a session on an existing task. The ▶ on a list row or in task details **adds it alongside** whatever is running (Shift+click switches instead). Picking a task in the switcher **switches** (Shift+Enter adds alongside). |
| **Alongside** | "+ Also working on…" (phone), or Shift with ▶ New / the switcher (desktop). |
| **❚❚ Pause** | The everyday way out of a task, so it's the prominent button on a running card (Alt+P pauses the top one, Alt+Shift+P pauses all). The clock stops, but the task **stays on the Now stack** as a compact paused card with ▶ Resume, which adds it back alongside whatever is running (Shift switches, pausing the others). Switching to another task pauses the old one the same way. Resuming within 10 min reopens the same session. |
| **■ Stop** | Per card (quiet ■ button), task details, or "Stop all". Stops the clock **and takes the task off the Now stack**. Stop all also clears paused tasks. **❚❚ Pause all** (shown when 2+ are running) pauses everything running. |
| **+ Inbox** | Add an unstarted task (title, optional client) without touching the clock. |

*Back was tried and removed. The switcher's recent-first list plus running several tasks at once
covered the same need without taking up space.*

### Finding tasks is a first-class feature

Continuing earlier work is as common as starting new work, so finding a task must be as fast as
pressing ▶ New.

- **Switcher**: one hotkey (desktop) or one tap (phone) opens a search box over a list of tasks
  ordered by **most recently worked on**. Type to filter across title, client, ticket ref and
  session notes. Enter/tap = ▶ Continue. If nothing matches, Enter = ▶ New with that text as the
  title.
- **Client filter**: chips in the switcher or task list narrow to one client's tasks, still
  recent-first ("recent for Acme").
- **Recency is by last session start**, not creation date, so something touched ten minutes ago
  is at the top even if it was created last month.
- Views: *Recent* (default), *Day* (today by default, or any day, with ‹ › and a date picker; includes archived
  tasks, since it's a log of the day), *By client*, *Inbox*, *Done* (with an *Archived* section
  below it, collapsed).
- **Title**: an untitled task's Title field shows the first line of its notes as real text,
  tracking the notes until it's edited; editing it sets the title. Clearing it goes back to
  following the notes.

### Surfaces

1. **Now stack**: one card per running task (timer, title, client, work type, **note field**,
   Pause, Stop; tapping "Started 9:12" opens a start-time control with −5 / +5 min, for "I
   actually started ten minutes ago"), newest on top, then one compact card per paused task (title, client, time
   paused, today's total, ▶ Resume, ■ Stop). Paused state is synced (`task.pausedAt`), so
   every device shows the same stack. On desktop this becomes a small always-on-top window. On the phone it's
   the top of the main screen.
2. **Switcher** (above).
3. **Inbox**: unstarted tasks, by client (or by project).
4. **Sidebar** (planned): browsing views, for finding things more easily than a global search.
   The core supplies some, the profile and integration add more:

   ```
   Now
   Inbox
   Schedule        (later)
   Projects        ← core: the project tree; CW-linked ones marked
   Tasks           ← core
   ─────────
   Clients         ← profile: a groupBy field → Client page
   CW Tickets      ← integration: tracked tickets + live CW search
   CW Projects     ← integration: tracked projects + live CW search
   ```

   The core views get an extra "From ConnectWise" search source when CW is on (§10); they
   aren't replaced by CW versions.
5. **Task detail**: title, project, profile fields (client, ticket #…), description, and
   sessions grouped by day with daily subtotals and each session's notes.
6. **Day page** (M3, built 2026-10-10; replaced the Time entries dialog
   and the planned Day report): one full-width page for seeing a day, fixing it, and entering it
   into CW. See below. **Mark entered** sets `session.enteredAt` (undoable). An entered session
   is never reopened by resume-within-gap, and a merge only stays entered if every part was.
   Times are plain `8:00 AM`, dates `MM/DD/YYYY`.

### Day page (M3)

Built for the desktop (§2, principle 7). Opened with **Entries** / Alt+E, full width:

```
Day  ‹ Fri 10/09/2026 ›  Today                         [ Day | To enter ]    7h 45m
┌─ calendar ───────────────┬─ entries ─────────────────────────────────────────────────────┐
│ 8 ┌──────────────────┐   │ #106745 · Acme · firewall replacement       3:00  ✓ Mark all  │
│   │ #106745 Acme     │   │   8:00 AM–10:00 AM  2.00  Remote - BH  [B|NB|NC]  swapped… ✓ │
│ 9 │ firewall         │   │   1:30 PM– 2:30 PM  1.00  Remote - BH  [B|NB|NC]  (contin.) ✓ │
│10 └──────────────────┘   │ Weekly internal                             0:15              │
│   ░░░░░░ gap ░░░░░░░░░   │   8:00 AM– 8:15 AM  0.25  Comms        [B|NB|NC]  calendar… ✓ │
│11 ┌───────┐┌───────┐     │                                                               │
│   │ Mtg   ││ Sam   │     │                                                               │
└──────────────────────────┴───────────────────────────────────────────────────────────────┘
```

**Header:** the day picker (‹ date › Today, as in the task list's Day view), the day's total, and
**Day | To enter**. To enter is the table alone, full width, across days, with a Date column.

**Saving space** (2026-10-12): each task's header row has a ▾ / ▸ toggle that hides its
session rows (they stay in the table, invisible, so the columns keep their widths), and the
header has **Collapse all / Expand all**. Which tasks are collapsed is remembered per device;
picking a session on the calendar opens its task. With a mouse, the table's text is a step
smaller (14px); touch screens keep 16px so iOS doesn't zoom into inputs.

**Calendar** (left, a custom component styled from the app's tokens):
- A vertical timeline of the day, opening on the workday (about 7 AM–7 PM) and scrolling to the
  rest; a line marks now.
- **Blocks**, one per session, labeled with the task title, ticket #, client and work type.
  Concurrent sessions sit side by side in columns, like overlapping meetings. The running one
  grows live. Entered sessions are drawn quieter.
- **Drag a block to move it; drag its top or bottom edge to resize.** Times snap to 15 min
  (hold Alt for 1 min). A running block's start can move; its end is "now".
- **Drag across empty space to add time:** the switcher opens over the span; pick a task, or type
  a title for a new one, and a session covering exactly that span is created. Esc cancels.
- **Gaps** between the day's first and last session are shaded, so missing time stands out.
- **Click a block** to select it: its table row highlights and scrolls into view (and the
  reverse). Double-click opens Task details.

**Table** (right):
- Grouped by task, because entries go into CW ticket by ticket. A group's header row is a row
  of the table: Ticket # and Client (task fields, click to copy) in their own columns at the
  left, under their headings, then the title across the rest of the row (cut with "…") with the
  total, **+ Add time**, **Merge…** and **Push all** / **✓ Mark all entered** at its end. Session
  rows leave the Ticket # and Client cells blank, like a grouped spreadsheet. (Settled
  2026-10-10 after trying a staggered header, fixed slots, and the fields on the first session
  row: each either didn't line up with the column headings or looked per-session.)
- One row per session (= one CW entry): Start, End, Hours, Work type, Billing, ✓ Mark entered. Click a value to copy it. Work type and billing are set
  right in the row; ✎ opens the session editor under the row. No Notes column (dropped
  2026-10-10: a row can't show them usefully): they're on ✎'s tooltip, in the push preview and
  in Task details.
- **Billing** is a segmented control, `B | NB | NC`: the profile gives a choice field short
  labels and `"input": "segmented"`; the full names show as tooltips.
- What's missing (ticket, client, work type) is flagged in the row, as today.

**Phone:** the table as stacked rows with the calendar below, long-press to drag. It has to
work, but the phone isn't what this page is designed for.

**Build order:** (1) the page and table, with the segmented billing control, replacing the
dialog (**done** 2026-10-10: a page, not a dialog, so Task details and the switcher open over it;
Esc or ← Now goes back; ▶ New returns to Now); (2) the calendar, read-only, linked to the table
(**done** 2026-10-10: `DayCalendar.tsx`, 64 px an hour, gaps of 5 min or more shaded, a line
at now; layout in `calendar.ts`, tested); (3) drag to move and resize (**done** 2026-10-10,
mouse and pen: a press becomes a drag after 4 px, so a click still selects; Esc cancels; the
drop shows a toast with Undo, which also restores "entered"; a session that crosses midnight
isn't draggable; touch only selects for now); (4) drag across empty space to add time
(**done** 2026-10-10: a dashed ghost shows the span; the switcher opens as "Add 3:00 PM–3:45 PM
to…"; a new title makes a new task; the new session is selected). Left for later: dragging on
touch screens (docs/backlog.md).

### Time entry (editing sessions)

One **session editor**, used in both Task details (tap a session) and Time entries (✎ Edit on
an entry): Date (moves the whole session), Start, End (native time inputs, so the iPhone shows
its wheel; an end before the start means past midnight), Deduct (min), Work type, Notes,
**Snap to 15 min** (rounds start/end to the nearest quarter hour), **Delete** (with an Undo
toast). Changes save as you go. Recorded timer times are stored exactly until edited.
**Now** beside Start and End sets it to the current minute, like CW's clock button (2026-10-13):
for coming back to a ticket after its entry was pushed, End → Now, then Update…. Off when it
would put the end before the start (or the start after the end).

- **+ Add time** (Task details, and per ticket in Time entries) adds a manual session (the half
  hour before now, or midday on the day being viewed) and opens it in the editor.
- **Merge…** is an explicit mode in both places (Task details: tap a range; Time entries: tick
  entries). Same day only.
- **Editing an entered session** (times, notes, work type, deduct) clears "entered" and flags it
  *changed since entered*, so it comes back to To enter with a reminder to fix the CW entry.
  Marking it entered again clears the flag.

### Look & feel (TBD, but these are the requirements)

- High contrast, readable at arm's length and in sunlight.
- Obvious focus states. It should always be clear which field or button is active.
- Large tap targets (≥ 44 pt). The primary action on each screen is unmistakable.
- Light and dark themes from one set of design tokens. Settings → Colors picks System, Light
  or Dark per device (not synced).

### Safety nets
- A running timer past a threshold (e.g. 3h, or past end of workday) triggers a nudge: "Still
  working on X?"
- Deleting is soft (archive) by default. Hard delete requires confirmation.

## 8. Platforms

**iPhone 13 (iOS 18+), installed as a home-screen PWA.**

- iOS PWAs can't sync in the background, so the outbox sends when the app is opened, comes to
  the foreground or regains signal.
- **iOS Shortcuts are a first-class input.** The server exposes simple endpoints (*new & start*,
  *back*, *pause*, *note*), and Shortcuts call them. On an iPhone 13 that gives:
  - **Back Tap** (Settings → Accessibility → Touch): double-tap the back of the phone for
    *new & start*, triple-tap for *back*. This is the "physical button."
  - **Control Center / Lock Screen controls** (iOS 18): one-tap shortcuts without unlocking into
    the app.
  - **Siri**: "sideshow note" → dictate → appended to the running session.
  - Home-screen widget for the most common shortcuts.

**Windows desktop: a Tauri app wrapping the same UI.** It provides the always-on-top Now bar,
global hotkeys and a tray icon. A browser tab also works as a fallback.

## 9. Architecture

```
 ┌──────────────────┐       ┌──────────────────────────────┐
 │ iPhone PWA       │──┐    │ Mini PC (always on)          │
 │ iOS Shortcuts    │──┤    │  sideshow server             │
 └──────────────────┘  │    │   ├─ core API + live updates │
 ┌──────────────────┐  ├───▶│   ├─ SQLite (one file)       │
 │ Desktop (Tauri)  │──┘    │   ├─ integrations/ (CW, …)   │──▶ external systems
 └──────────────────┘ Tail- │   ├─ AI note cleanup         │──▶ Claude API
                      scale │   └─ nightly backup → cloud  │
                            └──────────────────────────────┘
```

- **Server**: runs on the always-on mini PC (the N97 is far more than enough). It owns the data,
  enforces the invariant, and holds all external credentials.
- **Database**: **SQLite**, one file. Daily backup (`VACUUM INTO`, 30 kept) to the NAS, done by
  the server itself.
- **Reachability**: public at `https://sideshow.<domain>` through a **Cloudflare Tunnel**, with
  **Cloudflare Access** as the login (only my email). There's no port forward, so it works from
  any network, including the work PC, with nothing installed there. Tailscale remains the private
  path for development and admin. See [docs/runbook.md](docs/runbook.md). A simple
  API token can still protect the endpoints on the home LAN later.
- **Clients hold a local copy + an outbox.** Every action is written locally first, with its real
  timestamp, then sent when reachable. This is designed in from M1.
- **Conflicts**: single user, so rare. Ops are applied in timestamp order, and the most recent
  edit to each field wins. Long text (session notes, Notes) is the exception: if the same text was edited on two
  devices while offline, keep both versions and flag it rather than silently dropping one.

### Stack

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript everywhere** | The UI must be web tech (iPhone). One language means the data model is defined once and shared by client, server, outbox and integrations. |
| UI | React + Vite | Familiar from v1, with the largest ecosystem. Styling from design tokens. |
| Notes editor | Markdown-first editor (e.g. Milkdown or CodeMirror 6 live preview) | Rich editing with plain markdown stored. Picked when that milestone comes up. |
| Desktop | Tauri | Always-on-top, global hotkeys, tray. Same UI code. |
| Server | Node + Hono | Small, typed, easy to run as a Windows service. |
| DB | SQLite via Node's built-in `node:sqlite`, plain SQL (no native build step) | Four small tables don't need an ORM. Numbered migrations in `server/src/db.ts`. |
| Sync | Ops + shared reducer | Every change is an op. The client applies it instantly and queues it; the server applies the same op with the same code (`shared/src/reducer.ts`), persists it, and pushes the result to every device over SSE. |

## 10. Integrations

An integration goes with a profile (§4): the profile says which fields exist, the integration
connects them and the core records to an external system. Each integration implements
whichever parts make sense.

| Capability | Meaning | CW example |
|---|---|---|
| `mapping` | Which external entity becomes which core record or field | see the CW table below |
| `syncList` | Fill a profile `list` field from the external system | Work types (+ billing default); companies → clients |
| `search` | Live search sources for the sidebar and the switcher | CW tickets, CW projects, companies |
| `track` | Import a search result as a linked local record | A ticket → task; a project → project + chosen tickets |
| `lookup` | Refresh a linked record or a typed-in reference | Ticket # → summary, company, closed |
| `pushSession` | Create an external entry from a session | POST time entry to the ticket |
| `views` | Extra sidebar views | CW Tickets, CW Projects |

- The core stores only a generic link on each record: `{integration, externalId}`.
- A pushed session remembers its external ID so it's never pushed twice. Editing it after it's
  been pushed flags it for attention.
- Copy-to-clipboard isn't an integration capability: the Time entries sheet is core, shaped by
  the profile's `entryFormat`.

### Tracked vs. findable

Nothing is imported in bulk. The external system stays the place where *everything* is; sideshow
holds what I've chosen to work with.

| | Lives where | Example |
|---|---|---|
| **Tracked** | Local, synced, works offline | The CW projects I'm active on, and the tickets of theirs I actually use |
| **Findable** | Stays in the external system, searched live through the server | Every other project, ticket and company |

Search shows local results first, then a **"From ConnectWise"** section. Picking one offers
**Track**, which imports it as a local record with its link. Once tracked, it's mine: if the
integration goes away, the project or task stays and only the link goes dead (principle 5).

**Tracking a project** lists its tickets with checkboxes. The profile can preselect tickets by
name, for the ones a project template always creates and I work out of most (Project
Coordination, Client Communication, In-house Preparation). Picking the project and jumping into
its coordination ticket is then two clicks.

### ConnectWise (first integration)

| CW | Core |
|---|---|
| Project | Project (linked) |
| Service ticket / project ticket | Task (linked, `ticket` field filled) |
| Company | An item in the `clients` list (linked) |
| Work type | An item in the `workTypes` list (synced, carries a billing default) |
| Time entry | Pushed from a session (`billing` → CW's Billable / Do Not Bill / No Charge) |

- **Client mapping**: CW has duplicates (active / lead / former…). Filter to active client types
  and map each local client to one CW company **once**.
- **Ticket # workflow** (works today): find the ticket in CW manually, paste its number into the
  task → sideshow fetches the summary + company (the summary becomes the task's title,
  replacing whatever it was), and from then on **pushes each of that task's
  sessions as its own time entry on that ticket**. From M5, searching CW and choosing **Track**
  replaces the manual search; pasting a number still works.
- **Creating a ticket from a task** (built 2026-10-12, `integrations/connectwise/tickets.ts`,
  `web/.../CreateTicket.tsx`): **New ticket…** in Task details and on a Day page task with no
  ticket #. The dialog: **Summary** (the task's title, CW's 100-character limit), **Company**
  (the task's client, which must be linked; the client picker is right there to fix it),
  **Board** (service boards only; this device remembers the last one, else Tier 1), **Type** and
  **Status** (the board's defaults), **Owner** (CW_MEMBER, shown as a chip with an **×**;
  removing it leaves the ticket unassigned in the board's queue, where the service coordinator
  assigns a tech), optional **Description** (the task's description) → the ticket's initial
  description. CW's automatic emails stay off; the contact is the company's default. The server
  makes the ticket (`POST /api/cw/tickets`, refusing a task that already has a ticket, an unlinked
  client, or a second click while one is being made), then puts the number and summary on the
  task with ops, so every device sees it and its sessions push to the new ticket.
  - **Time already on the task** (added 2026-10-12): "Push its N time entries to the new
    ticket" is ticked by default when the task has unentered sessions ready to push (work type
    and billing set, not running). The server pushes them right after making the ticket, in the
    same request, as the Day page's push would (email per entry, off unless turned on). Ones that
    can't go yet are named in the dialog and left for the Day page; if a push fails, the dialog
    says which before closing.
- **Rate limit**: CW answers 429 ("Too many requests. Please try again in 30 seconds.") when
  sideshow sends too much at once, e.g. the first company sync plus loading boards. The client
  waits as long as CW asks (Retry-After or the message, 1–60 s) and tries again, up to 3 times;
  the first sync asks 4 companies at a time, and boards load one at a time.
- **Sync feedback**: while the server syncs companies, the header shows a spinner and "Syncing
  ConnectWise companies… 312 of 745" ("CW sync 312/745" on a phone), as do the client picker
  and Settings › Clients; the browser asks for progress every 3 s. Until the first sync is done,
  ticket dates (and so which duplicate wins) are incomplete. Loading boards and creating a ticket
  have spinners too.
- **Testing against the live instance**: test tickets go on **Veritaz IT Solutions** (CW company
  id `19300`, identifier `veritasitsolutions`), not on a client. Beware the lookalikes "Veritas IT
  Solutions" (19593) and "Veritaz IT" (20018). The standing test ticket is **#106745**
  ("API test ticket (please leave open)", Internal board, type New Tool Testing, owner and contact
  Evan = member 192, Do Not Bill, automatic emails off).
- **Notes are Markdown in CW**: its editor stores "(…)" as `\(…\)`. Notes sideshow pushes (and
  reads back) must be treated as Markdown: escape or allow for it. Seen in CW notes (2026-10-13):
  `**bold**`, `*italic*`, `* ` bullets, `1. ` numbers, `[text](url)`; pictures pasted in CW's
  editor are hosted by CW (`![image](https://na.myconnectwise.net/v2025_1/api/newinlineimages/
  veritasits/<guid>/<guid>)`, an editor endpoint, not the public API). **Underline is `__text__`**
  (seen on #106745; plain Markdown would read that as bold).
- **Attachments on push** (2026-10-13): every file a session's notes link to (`/api/files/…`) is
  uploaded to the entry's ticket as a CW document (`POST /system/documents`, multipart; private
  when the notes go to Internal) before the entry is made, once per ticket (`cw_documents`). If
  one can't be attached, the entry isn't made. In the entry's notes each picture or file link
  becomes "*Attachment: name*", and underline (`++…++` in sideshow) goes as CW's `__…__`.
- **Keep the name "sideshow" out of CW** for now: no app name in summaries, descriptions or
  notes that sideshow writes. New tickets default the contact to the company's primary contact
  (Veritaz: Vitoria Bianci), which is another reason CW's automatic contact emails stay off.
- **Duplicates, measured 2026-10-06**: 745 companies; 566 Active (326 type Customer, 203 Client,
  28 Lead…). CW's company search shows ~385, a filter not yet identified. Suspicion: many
  "Customer" records are leftovers (e.g. Veritas 19593 with identifier `0` beside the real Client
  record), possibly from the Autotask migration. Client mapping has to cope with this.
- **Duplicates, measured again 2026-10-12** with ticket counts and last ticket date per record
  (service + project tickets): 230 groups of records with the same name (case, punctuation and
  Inc/LLC/PC ignored). Ticket counts don't pick the right one: in 188 groups several records
  have tickets, and the leftover often has more (old history). **The last ticket date does:** in
  no group do two records have a ticket since 2025-01-01; 182 groups have exactly one, 48 none.
  The leftovers are type **Customer** (ids 19593–19945, identifiers like `ZenDentalGroup7C6` or a
  phone number, last ticket mid-2024 or before). The real records are type **Client** (274;
  identifiers like `zendentalgroup`) or **Former Client** (108), plus new companies that start
  as **Lead** / Prospect and get tickets that way (~22 since 2025). Exceptions: 7 Client-type
  pairs like "PDA Dental Group (Reading)" vs "PDA Dental Group - Reading" (`…2`, no tickets at
  all), so name matching must also ignore "( )" vs " - ".
- **Company picker** (built 2026-10-12): the server keeps a copy of every company with its
  type, status and last ticket date (`cw_companies`; `integrations/connectwise/companies.ts`).
  The first sync asks CW for each company's newest service and project ticket (~1,500 requests);
  later ones, at startup and every 4 hours, read only tickets with a higher id. In each
  same-name group (`companyKey` in `shared/src/companies.ts`) one record is **the** company:
  newest ticket, then Client > Lead/Prospect > Former Client > other, then non-Customer, then
  lowest id. The rest are **older duplicates**, hidden unless "Show older duplicates" is ticked.
  - The **Client** field, with CW on, lists your clients first (a green chain on linked ones),
    then **From ConnectWise**: matching companies not linked yet, clients before leads before
    former clients, each with its tag and last ticket month. Picking a company links it to the
    unlinked client of the same name, or adds a new linked client. "Add “…” (not in
    ConnectWise)" still adds a plain one.
  - A client's link is `ext.cw.companyId` on its list item (`list.update` merges `ext` like a
    session's). The link is the manual override: linking a client to an older duplicate is
    allowed, from the Clients dialog with "Show older duplicates" ticked.
  - **Settings › Clients…** lists your clients: link / change / unlink each, **Remove** (archived,
    so tasks keep their value; Undo, and Restore under Removed), "Update now", and a one-click
    **Link all** for unlinked clients whose name is a company's.
  - **The ticket decides the client** (2026-10-12): a ticket lookup sets the task's client to
    the ticket's CW company, **replacing** whatever was there ("Veritaz" → "Veritaz IT
    Solutions"): the client linked to that company, else an unlinked one of the same name
    (`companyKey`, which gets linked), else a new linked one. Skipped if the ticket # changed
    while the lookup ran. Creating a ticket needs a linked client.
  - **A linked client takes its company's CW name**, when linked (picker, Link…, Link all) or
    looked up. Settings › Clients offers **Use the ConnectWise names** for clients linked
    before that, and **Merge** when several clients are linked to one company: the one with the
    company's name (else the most-used) stays, every task on the others moves to it, and the
    others are removed (archived). Task fields only; sessions aren't touched.
- **Pushing time entries** (M4, built 2026-10-10). From the Day page: a row's **Push…**, a
  ticket group's **Push all N…**, or tick rows and **Push N selected…**. Every push goes through
  a preview (ticket, date, times, hours, work type, billing, where the notes go, who gets
  emailed, what can't go yet and why), then shows each entry's result. Per entry:
  - **Notes to** `Internal | Discussion` (a profile field, `noteTo`, default Internal; carries
    over to the task's next session like other fields).
  - **Email** off/on (on = CW emails the ticket's contact, CCs and resources). Off by default and
    **never carried over**: it lives in the session's integration data (`ext.cw.email`), not in
    its fields. It can't be changed once pushed; CW only emails when an entry is first added.
  - The entry is made as `CW_MEMBER` (`.env`, e.g. `ecartwright`), with UTC times to the
    minute, `hoursDeduct` from Deduct, work type by name → CW id, billing → `Billable` /
    `DoNotBill` / `NoCharge`, empty notes → "Continuation of previous work". The ticket's kind
    (service or project) is looked up first.
  - A pushed session records `ext.cw.entryId` (and the ticket) and is marked entered. Editing it
    afterwards flags it as usual; its button becomes **Update…**, which PATCHes that same CW
    entry (no email flags; the ticket only if it changed). If the entry was deleted in CW, the
    push makes a new one.
  - The client sends its queued edits before asking the server to push (`sync.sendNow`), so CW
    gets what's on screen.
  - **Deleted in CW**: opening the Day page (or changing its day or tab, or a group's ↻) asks CW
    whether the pushed entries on screen still exist (`POST /api/cw/check`, one request). Any
    that don't go back to To enter with "⚠ Deleted in CW" (`ext.cw.removedAt`) and a toast;
    pushing again makes a new entry. Changes made to an entry inside CW aren't read back yet.
  - Not handled yet: deleting or merging pushed sessions in sideshow leaves their CW entries as
    they are.
- **Ticket link**: the ticket # (Day page) and the ticket summary (Task details) open the ticket
  in CW, in the form of CW's own Share link:
  `https://na.myconnectwise.net/v4_6_release/services/system_io/Service/fv_sr100_request.rails?service_recid={id}&companyName={CW_COMPANY_ID}`
  (the API host without `api-`; `CW_TICKET_URL` overrides). Tried first and failed on this
  instance: `fv_sr100_request.rpp?srRecID=` (500) and `router/openrecord.rpp` (doesn't open).
- **Later / maybe**: suggest likely existing tickets for a client. Read other people's ticket
  updates back into the app.

## 11. AI note cleanup

A **"Clean up"** button on a session (or a task's day) sends the raw notes to the Claude API
server-side and returns a formatted version per a **configurable template**. The current one is
**Actions Taken**, **Communication**, **Next Steps**. I review it before accepting. Raw notes are
always kept.

## 12. Milestones

Renumbered 2026-10-10 into the order they'll be built (the old numbers, such as M1.5 and M5,
appear in commits and notes from before then). M4 and M5 swapped the same day: pushing time
entries comes first. **M4 is built and pushed live (test ticket #106745); next is M5.**

| # | Goal | Status | Done when… |
|---|---|---|---|
| **M1** | Core app | **Done**, except three pieces that moved: the Day report → M3's Day page; the Client page → with the sidebar (M6); plain-text export → later | Server on mini PC + web UI on iPhone and desktop browser. ▶ New / ▶ Continue / alongside / Stop, stacked running cards with notes, blip discard, resume-within-gap, session merge. Switcher with recent-first search + client filter. Inbox. Time picker, manual sessions, deduct. Client and work type lists. Task detail by day. Outbox in place. |
| **M2** | Projects & profiles | **Done** 2026-10-10 | Projects (any depth) with tasks under them, and a Projects view. The profile engine (§4): field types, the `fields` blob, one active profile, `entryFormat` driving Time entries. Client, work type and ticket # moved out of core columns into the CW profile (a migration), with no change in what I see. With no profile, the app is a plain task and time tracker. Billing field with defaults per work type. |
| **M3** | Day page & calendar | **Done** 2026-10-10 on the desktop; touch dragging is in the backlog | The Day page (§7): calendar and entries table side by side, drag to move/resize, drag across empty space to add time, visible gaps, segmented billing control. |
| **M4** | CW write | **Done** 2026-10-10 | Push sessions as time entries from the Day page (one, a ticket's, or ticked ones) through a preview; notes Internal / Discussion; email per entry, off by default; edits update the same CW entry; ticket # links to CW (§10). |
| **M5** | CW tickets & lists | Started: ticket lookup done | Ticket lookup (done). Live CW ticket search with **Track**. Client mapping (local client → one CW company, coping with duplicates). Work-type sync with billing defaults. |
| **M6** | CW projects | Not started | CW project search, Track with ticket picking and template preselection, the sidebar with CW Tickets / CW Projects views and a Client page. |
| **M7** | AI note cleanup | Not started | Clean-up button with template. |
| **M8** | Notes | Not started | Markdown Notes, standalone or on a project, tied to a client with CW; line → inbox task (§5, Notes). |
| **M9** | Desktop app | Not started | Tauri: always-on-top Now bar, global hotkeys (▶ New, Switcher, Stop), tray. |
| **M10** | Hands-free capture | Not started | Shortcuts endpoints → Back Tap, Control Center, Siri note. |
| **M11** | Bad-signal hardening | Not started; only if still needed | Airplane-mode test on iPhone, no lost ops. (The "pending sync" indicator is done.) |
| later | Nice-to-haves | — | Plain-text export, AI-generated task titles from notes (like chat titles), natural-language quick capture, Obsidian mirroring, Google Calendar/Maps, native iOS app. |

## 13. Open questions

None blocking M1. Decisions made along the way:

- Session notes are the time entry notes: raw → AI cleanup → pushed. Task description is
  optional context.
- ▶ New starts untitled. The first line of the notes stands in as the title until it's named.
- One session = one CW time entry.
- Notes (once called the client scratchpad) are M8. Inbox tasks cover that need until then.
- 2026-10-10, three layers (§4): **core** (task-oriented, not ticket- or MSP-oriented),
  **profile** (an inclusion list of fields: omitted means absent) and **integration** (API
  code). Ticket #, client, assignee, work type and billing are all profile fields, not core.
  Billing has three values at this job, named as in CW: Billable, Do Not Bill, No Charge (shows on
  the invoice). Each work type carries a default (Remote/Onsite/In-house Business Hours: Billable;
  every other, including Travel: Do Not Bill), set by the profile until M5 syncs work types.
  There is no charge-to field.
- 2026-10-10: **one profile at a time**. Switching keeps the values, hidden.
- 2026-10-10: **projects are core**, nest to any depth, and can hold both my own groupings and
  linked CW projects. CW items are **tracked** only when I choose; everything else stays
  **findable** by live search (§10).
- 2026-10-10: renamed **fieldtime → sideshow** (§1), lowercase everywhere except a few titles
  (the README heading). It replaced "juggle" (chosen 2026-10-08, never used).
