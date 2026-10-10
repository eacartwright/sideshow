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
(later) a quick **scratchpad** per client.

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
  The profile supplies them until an integration does (M6). When the profile's defaults
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
| **Client scratchpad** | Client | Quick jottings that aren't tasks *yet*. Turned into tasks afterwards. (Later milestone.) | "FD1 printer not working. Wifi slow." |

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
| `notes` | Stream-of-consciousness notes. Dictation works here. |
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

### Client scratchpad (later milestone)
One markdown scratchpad per client, one tap from anywhere that client appears. It's for the
"they mentioned ABC and DEF on the call" moment, where you jot it down now and turn it into
tasks after the call (or after the next interruption). Each line gets a **→ task** action that
creates an inbox task under that client from the line's text. The editor renders rich text but
stores plain markdown. *Maybe:* mirror scratchpads into the Obsidian Work vault.

Until then, the Inbox covers the same need: quickly add unstarted tasks under the client.

The **Client page** shows everything for that client in one place: open tasks, inbox items,
recent sessions (and later the scratchpad). This is the screen for "I'm at XYZ, open the app,
select XYZ." In general terms it's the page for one value of a profile's `groupBy` field (§4);
with no such field there's no Client page. The scratchpad may hang off a project instead, or as
well; decide at M10.

### Work type list (CW profile)

Synced from CW at M6; until then, seeded from the profile:

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
   later from the Day report.

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
6. **Day report**: the screen used when entering time. For a date (or a week), each task with
   its sessions and a per-task total for that day. Each session is one line and becomes one CW
   time entry:

   ```
   MON SEP 28                                     total 7:45
     #50 Acme – firewall replacement               3:00
        8:00–10:00   Remote - Business Hours   "swapped config…"
        1:30– 2:30   Remote - Business Hours   (continuation)
     Weekly recurring internal                     0:15
        8:00– 8:15   Communications            "calendar, email…"
   TUE SEP 29
     #50 Acme – firewall replacement               1:00
        2:00– 3:00   Onsite - Business Hours   "…"
   ```
   Gaps between sessions are shown.
7. **Time entries** (built, Alt+E / **Entries**): what to type into CW, **grouped by task**,
   because entries go in ticket by ticket, not chronologically. Each task is a collapsed row
   (title, #ticket, client, entry count, total, ⚠ what's missing); tapping it shows Ticket # and
   Company once, then one block per session (= one CW entry): Date, Start, End, Hours (decimal,
   after deduct), Work Type, Notes. **Clicking a field copies it** ("Copied ✓"). Missing ticket /
   client / work type are filled in right there. **Mark all N entered** per task. **To enter** lists every session not
   yet marked entered, across days (running ones last, can't be marked); **By day** shows a
   chosen day's sessions. **Mark entered** sets `session.enteredAt` (undoable). An entered
   session is never reopened by resume-within-gap, and a merge only stays entered if every
   part was. Times are plain `8:00 AM`, dates `MM/DD/YYYY`.
8. **Day calendar** (planned): the same day drawn like Google/Outlook calendar or CW Time
   Sheets. See below.

### Day calendar (planned)

A vertical timeline of one day, with each session drawn as a block. It's for *seeing* the day:
spotting a gap and thinking "oh right, that's when I helped Sam with the switch," then filling it
in on the spot.

- **Blocks**: one per session, labeled with the task title, client and work type. Overlapping
  (concurrent) sessions sit side by side in columns, as calendars do with overlapping meetings.
  The running session grows live.
- **Drag to move, drag the edges to resize.** Times snap to the snap setting (5/15 min). This
  becomes the fastest way to fix times, often faster than typing them.
- **Gaps are visible.** Unaccounted stretches within the workday are shaded. Tapping or dragging
  across a gap opens the switcher to pick an existing task or type a new one, and creates a
  session exactly covering that span.
- **Tap a block** to open its session (notes, work type) or the task. Select several of the same
  task to merge.
- **Phone**: the same view in one narrow column. Long-press to drag, tap a gap to fill it.
- **Later**: a week view (days side by side), matching CW's weekly Time Sheet.

Needs from the core: a `session.create` op (manual session with start/end), and editing
start/end, which the editing half of M1 adds anyway. The calendar is a natural home for that
editing, so it may replace much of the form-based time picker. Implementation choice at build
time: a custom timeline (full control, small) or FullCalendar's time-grid (MIT, has drag/resize).

### Time entry (editing sessions)

One **session editor**, used in both Task details (tap a session) and Time entries (✎ Edit on
an entry): Date (moves the whole session), Start, End (native time inputs, so the iPhone shows
its wheel; an end before the start means past midnight), Deduct (min), Work type, Notes,
**Snap to 15 min** (rounds start/end to the nearest quarter hour), **Delete** (with an Undo
toast). Changes save as you go. Recorded timer times are stored exactly until edited.

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
- Light and dark themes from one set of design tokens.

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
- **Database**: **SQLite**, one file. Daily backup (`VACUUM INTO`, 30 kept) to OneDrive, done by
  the server itself.
- **Reachability**: public at `https://sideshow.<domain>` through a **Cloudflare Tunnel**, with
  **Cloudflare Access** as the login (only my email). There's no port forward, so it works from
  any network, including the work PC, with nothing installed there. Tailscale remains the private
  path for development and admin. See [docs/home-hosting.md](docs/home-hosting.md). A simple
  API token can still protect the endpoints on the home LAN later.
- **Clients hold a local copy + an outbox.** Every action is written locally first, with its real
  timestamp, then sent when reachable. This is designed in from M1.
- **Conflicts**: single user, so rare. Ops are applied in timestamp order, and the most recent
  edit to each field wins. Long text (session notes, scratchpads) is the exception: if the same text was edited on two
  devices while offline, keep both versions and flag it rather than silently dropping one.

### Stack

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript everywhere** | The UI must be web tech (iPhone). One language means the data model is defined once and shared by client, server, outbox and integrations. |
| UI | React + Vite | Familiar from v1, with the largest ecosystem. Styling from design tokens. |
| Scratchpad editor | Markdown-first editor (e.g. Milkdown or CodeMirror 6 live preview) | Rich editing with plain markdown stored. Picked when that milestone comes up. |
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
  task → sideshow fetches the summary + company, and from then on **pushes each of that task's
  sessions as its own time entry on that ticket**. From M6, searching CW and choosing **Track**
  replaces the manual search; pasting a number still works.
- **Creating a ticket from a task** (planned): the **Ticket Owner** defaults to me (probably; not
  final), shown as a chip with an **×**. Removing it leaves the ticket unassigned so it lands on
  the **Tier 1** service board, where the service coordinator assigns a tech. Often I'll want it
  myself; sometimes I deliberately drop it in the queue.
- **Testing against the live instance**: test tickets go on **Veritaz IT Solutions** (CW company
  id `19300`, identifier `veritasitsolutions`), not on a client. Beware the lookalikes "Veritas IT
  Solutions" (19593) and "Veritaz IT" (20018). The standing test ticket is **#106745**
  ("API test ticket (please leave open)", Internal board, type New Tool Testing, owner and contact
  Evan = member 192, Do Not Bill, automatic emails off).
- **Notes are Markdown in CW**: its editor stores "(…)" as `\(…\)`. Notes sideshow pushes (and
  reads back) must be treated as Markdown: escape or allow for it.
- **Keep the name "sideshow" out of CW** for now: no app name in summaries, descriptions or
  notes that sideshow writes. New tickets default the contact to the company's primary contact
  (Veritaz: Vitoria Bianci), which is another reason CW's automatic contact emails stay off.
- **Duplicates, measured 2026-10-06**: 745 companies; 566 Active (326 type Customer, 203 Client,
  28 Lead…). CW's company search shows ~385, a filter not yet identified. Suspicion: many
  "Customer" records are leftovers (e.g. Veritas 19593 with identifier `0` beside the real Client
  record), possibly from the Autotask migration. Client mapping has to cope with this.
- **Later / maybe**: suggest likely existing tickets for a client.

## 11. AI note cleanup

A **"Clean up"** button on a session (or a task's day) sends the raw notes to the Claude API
server-side and returns a formatted version per a **configurable template**. The current one is
**Actions Taken**, **Communication**, **Next Steps**. I review it before accepting. Raw notes are
always kept.

## 12. Milestones

| # | Goal | Done when… |
|---|---|---|
| **M1** | Core loop | Server on mini PC + web UI on iPhone and desktop browser. ▶ New / ▶ Continue / alongside / Stop, stacked running cards with notes, blip discard, resume-within-gap, session merge. Switcher with recent-first search + client filter. Inbox. Time picker, manual sessions, deduct. Groups + categories as local lists (labels "Client"/"Work Type"). Task detail by day, Day report, Client page. Plain-text export. Outbox in place. |
| **M1.5** | Day calendar | Day timeline with drag/resize, visible gaps, tap-a-gap to fill it. Candidate to carry most of M1's time editing. |
| **M2** | Hands-free capture | Shortcuts endpoints → Back Tap, Control Center, Siri note. |
| **M3** | Desktop presence | Tauri: always-on-top Now bar, global hotkeys (▶ New, Switcher, Stop), tray. |
| **M4** | Bad-signal hardening | Airplane-mode test on iPhone, no lost ops, "pending sync" indicator. |
| **M5** | Projects & profiles (core) | Projects (any depth) with tasks under them, and a Projects view. The profile engine (§4): field types, the `fields` blob, one active profile, `entryFormat` driving Time entries. Today's client, work type and ticket # move out of core columns into the CW profile (a migration), with no change in what I see. With no profile, the app is a plain task and time tracker. |
| **M6** | CW tickets & lists | Ticket lookup (done before M5, moves onto the `ticket` field). Live CW ticket search with **Track**. Client mapping (local client → one CW company, coping with duplicates). Work-type sync with billing defaults. |
| **M7** | CW projects | CW project search, Track with ticket picking and template preselection, the sidebar with CW Tickets / CW Projects views. |
| **M8** | CW write | Push sessions as time entries (with billing) from Time entries / the Day report. |
| **M9** | AI cleanup | Clean-up button with template. |
| **M10** | Scratchpad | Markdown scratchpad per client (or project), line → inbox task. |
| later | Nice-to-haves | AI-generated task titles from notes (like chat titles), natural-language quick capture, Obsidian mirroring, Google Calendar/Maps, native iOS app. |

## 13. Open questions

None blocking M1. Decisions made along the way:

- Session notes are the time entry notes: raw → AI cleanup → pushed. Task description is
  optional context.
- ▶ New starts untitled. The first line of the notes stands in as the title until it's named.
- One session = one CW time entry.
- Scratchpad is deferred to M10. Inbox tasks cover that need until then.
- 2026-10-10, three layers (§4): **core** (task-oriented, not ticket- or MSP-oriented),
  **profile** (an inclusion list of fields: omitted means absent) and **integration** (API
  code). Ticket #, client, assignee, work type and billing are all profile fields, not core.
  Billing has three values at this job, named as in CW: Billable, Do Not Bill, No Charge (shows on
  the invoice). Each work type carries a default (Remote/Onsite/In-house Business Hours: Billable;
  every other, including Travel: Do Not Bill), set by the profile until M6 syncs work types.
  There is no charge-to field.
- 2026-10-10: **one profile at a time**. Switching keeps the values, hidden.
- 2026-10-10: **projects are core**, nest to any depth, and can hold both my own groupings and
  linked CW projects. CW items are **tracked** only when I choose; everything else stays
  **findable** by live search (§10).
- 2026-10-10: renamed **fieldtime → sideshow** (§1), lowercase everywhere except a few titles
  (the README heading). It replaced "juggle" (chosen 2026-10-08, never used).
