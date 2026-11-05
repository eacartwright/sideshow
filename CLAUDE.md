# sideshow — notes for Claude

A personal work log: frictionless start/stop and note-taking for whatever you're working on,
on desktop and phone. **[DESIGN.md](DESIGN.md) is the spec**; read the relevant section
before changing behavior, and update it when a decision changes. v1 (April 2026, React/Supabase)
was removed 2026-10-06; it's in git history as `v1/` up to commit `85996a4`.

## Run / test

```sh
npm install
npm run dev        # server :8787 + web :5173 (proxies /api); phone uses the LAN "Network" URL
npm test           # vitest: reducer rules in packages/shared
npm run typecheck  # tsc (TypeScript 7) over all three packages
npm run cw -- companies   # ConnectWise dev CLI (companies [--all] | diag | dupes | tickets <text> | note <id>)
```

Data is `data/sideshow.db` (SQLite, git-ignored, **per machine**). To test without touching the
user's real data, run on other ports against a scratch DB:
`SIDESHOW_DB=<scratch>/t.db PORT=7797 node --import tsx packages/server/src/index.ts` and
`SIDESHOW_API=http://localhost:7797 npx vite --port 5183` (from `packages/web`), or `npm run build`
and use the server alone. (On NOSTROMO 8577–8976 is reserved by Windows except 8787; see Gotchas.)
Browser checks: `playwright-core` with `channel: "msedge"` (Edge is installed; no browser download),
installed in a scratch folder, headless. For CW, point the scratch server at a fake CW with
`CW_BASE_URL=http://127.0.0.1:<port>` plus dummy `CW_*` values; never the live instance.

## Architecture

- `packages/shared` — types, ops, **the reducer**, derived views. Used by both server and client.
- `packages/server` — Node + Hono + `node:sqlite` (built in; needs Node ≥ 22.13). Applies op batches idempotently (op ids
  recorded in `ops` table), persists touched entities, bumps a global `rev`, pushes changes over SSE.
- `packages/server/src/integrations/connectwise` — CW REST client (`client.ts`, fetch + Basic auth)
  and a dev CLI (`cli.ts`). Credentials are `CW_*` in the git-ignored root `.env` (see `.env.example`).
  Writes go to the **live** CW instance: `note` asks before posting, and notes default to Internal
  with `processNotifications: false`. Test tickets/notes only on company **19300 Veritaz IT
  Solutions** (`veritasitsolutions`; DESIGN.md §10); the standing test ticket is **#106745**.
  Ids on this instance: boards Tier 1 = 1, Internal = 30; Evan = member 192 (`ecartwright`). Page with `orderBy=id asc` (name ordering repeats records).
  Settings › Connections edits the `CW_*` lines (`connection.ts`, `envfile.ts`;
  `GET /api/connections`, `POST /api/connections/cw[/test]`; the private key never goes to the
  browser, and is kept only while site/company/public key are unchanged; JSON +
  `Sec-Fetch-Site` only). `SIDESHOW_ENV_FILE` points a scratch server at a scratch `.env`.
  CW is optional: the server enables it only when `CW_SITE` is set and the profile has a
  `connectwise` section (`config.cw` in `/api/state`; the UI hides CW features otherwise). `npm run dev` loads the root `.env`. Endpoint so far:
  `GET /api/cw/tickets/:id` → `{summary, company, companyId, closed}`;
  `GET /api/cw/ticket-search?q=&companyId=&mine=1&closed=1` → service + project tickets (`ticketsearch.ts`);
  `GET /api/cw/boards` → service boards with types/statuses + the owner;
  `POST /api/cw/tickets {taskId, summary, boardId, typeId?, statusId?, assign, description?,
  pushSessionIds?}` → `{ticketId, pushed?}` (`tickets.ts`; writes the number onto the task, then
  pushes those sessions). The client retries CW's 429s after the wait CW asks for;
  `GET /api/cw/weekly` (+ `POST …/refresh`) → this week's recurring internal ticket (▶ WRIT,
  `weekly.ts`); `POST /api/cw/tickets/:id/summary` → rename a ticket;
  `GET|POST /api/cw/holds`, `POST|DELETE /api/cw/holds/:id`, `POST …/:id/days/:date {skip}`,
  `POST …/sync` → schedule holds, an entry per day on the CW calendar kept 4 weeks ahead
  (`holds.ts`, tables `cw_holds` / `cw_hold_days`; needs `CW_MEMBER`, `config.cwHolds`; header ›
  Holds, `HoldsDialog.tsx`, DESIGN.md §10);
  `GET /api/cw/companies` (+ `POST …/refresh[?full=1]`) → the cached CW companies, duplicates
  marked (`companies.ts`; the browser keeps a copy, `web/src/companies.ts`); `POST /api/cw/push {sessionIds}` →
  per-session results (`integrations/connectwise/push.ts`; needs `CW_MEMBER` in `.env`, else
  `config.cwPush` is false and the UI shows Mark entered only). Ticket lookup: entering a ticket #
  fetches it once you leave the field (Enter, Tab, a click elsewhere; it saves then, not per keystroke) and records it with the `task.refInfo` op, which is ignored
  if the ref changed since, and replaces the title with the ticket's summary. The ticket's company
  then **replaces** the task's company. Changing the ref clears `refInfo`. Tasks on the Now
  stack are looked up again on every load (`keepTitle`: a renamed title stays).
  The **Company** field (profile key still `client`, list `clients`) picks CW companies only;
  each picked one is a list item with `ext.cw.companyId`. No linking UI since 2026-10-14
  (DESIGN.md §10).
- **Profiles** (DESIGN.md §4): job fields are declared in `packages/server/profiles/<name>.json`,
  chosen with `PROFILE` in `.env` (no PROFILE = no job fields; stored values stay, hidden). Types
  and validation in `shared/src/profile.ts`; the server loads it at startup (`server/src/profile.ts`,
  a bad profile stops the server), seeds empty lists from it, and sends it as `config.profile`.
  Values live in `task.fields` / `session.fields` (`Fields`, unset = absent); list items (clients,
  work types) are `state.lists` (`ListItem`, `list` says which). UI renders fields generically
  (`FieldInput`, `TaskFieldInputs`, `SessionFieldInputs` in `fields.tsx`); Time entries follows
  `entryFormat`. A new field is a profile edit, not a code change. A list item can carry
  `defaults` (a work type's billing): the reducer applies them when the item is chosen, unless
  the same change sets that field, and the server fills missing defaults once when the
  profile's defaults change.
- **Workspaces** (DESIGN.md §4, 2026-10-20): separate data sets, each its own DB and profile.
  `server/src/workspaces.ts` (`Registry` = `data/workspaces.json`, `Workspace` = db + store +
  files + CW parts, `Workspaces`); main = `data/sideshow.db`, others `data/workspaces/<id>.db`.
  Routes get theirs from `c.get("ws")` (header `X-Sideshow-Workspace`, `?ws=` for SSE, default
  main); `/api/workspaces` and `GET /api/files/:id` aren't per workspace. Client:
  `web/src/workspace.ts` (`workspaceId`, `wsKey()` for per-workspace localStorage; main keeps
  the old keys), switching reloads. `/api/ops` refuses a batch whose `workspace` differs (409).
  Tests: `workspaces.test.ts` (incl. the CW → none → CW round trip).
- **Dialogs render into `document.body`** (`Dialog.tsx`, a portal): a CSS container above one
  could hold a fixed overlay inside its box.
- **Notifications** (DESIGN.md §7, 2026-10-31): Web Push. `server/src/push.ts` (VAPID keys +
  subscriptions in `data/push.json`, not per workspace; watches each workspace's store and
  pushes what's running when it changes, reminders every minute; `/api/push[/subscribe|
  unsubscribe|test]`), `web/public/sw.js` (the service worker: words the notification, badge;
  no fetch handler), `web/src/push.ts` + `NotificationSettings.tsx` (Settings › Alerts,
  per device). Every push must show a notification (iOS revokes otherwise). Headless Edge can
  test it for real: a **persistent** context (`launchPersistentContext`; incognito has no
  push) with `grantPermissions(["notifications"])`; delivery can take several seconds.
- `packages/web` — React + Vite. `sync.ts`: view = server state + pending ops replayed through the
  same reducer; pending ops persist in localStorage before sending (the outbox).
- **Notes are Markdown** (DESIGN.md §7 "Rich notes"): edited in `RichNotes` (TipTap; Markdown
  setup in `web/src/markdown.ts`, round-trip tests in `markdown.test.ts`; single line breaks
  stay line breaks so old plain notes are unchanged). Show notes as text with `plainNote`.
  Attachments: `POST /api/files` → `server/src/files.ts` (`data/files/`, backed up); a push
  uploads a note's files to the ticket first (`connectwise/documents.ts`) and `cwNotes` rewrites
  the note for CW.
- **AI note cleanup** (DESIGN.md §11, ✨): Anthropic and OpenAI, each on with its key in `.env`
  (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`). Models + prices and the
  prompt: `shared/src/ai.ts`; templates + rules are Markdown files in `server/ai-templates/`
  (`aiTemplates.ts`, read per call; its README says the format); server `server/src/ai.ts` (`Ai`: one `Ask` per provider, usage in
  `ai_usage`, settings in main DB `meta`), `GET /api/ai`, `POST /api/ai/settings|cleanup|compare`;
  UI `components/Cleanup.tsx` (dialog, ✨ button, Restore), `components/AiSettings.tsx`,
  `web/src/ai.ts`. Raw notes kept in `session.ext.ai.raw`. To try it without spending, point the
  SDKs at a fake: `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` (+ any key).
- **Dev notes** (DESIGN.md §7, 🧪 / Alt+B): notes about the app itself, one list for the server
  (`server/src/devnotes.ts`, table `dev_notes` in the main DB; `GET|POST /api/devnotes`,
  `POST /api/devnotes/:id` {text, done, files, deleted}; not per workspace, not synced state).
  Mirrored to `data/dev-notes.md` beside the main DB on every change: **read Evan's dev notes
  there** (on the mini PC, `C:\Apps\sideshow\data\dev-notes.md`). UI: `components/DevNotes.tsx`,
  `web/src/devnotes.ts`; "this page" comes from `here()` in `App.tsx` (+ `dayPageShown`).

Every change is an **op**. To add one: type in `shared/src/ops.ts` (+ `OP_TYPES`), handle it in
`shared/src/reducer.ts`, add tests in `reducer.test.ts`. The reducer must be deterministic and
safe to re-apply (the client replays pending ops on top of server state).

Schema changes: **append** a migration to `MIGRATIONS` in `server/src/db.ts`; never edit old ones.
Before migrating an existing database the server copies it to `<db>.before-v<N>.db`.
Ops from before profiles (groupId, ref, categoryId, group.*) may still sit in a device's outbox;
`upgradeOp` in the reducer maps them onto the CW profile's keys (`LEGACY_KEYS`). Keep it.
Deletions are tombstones (`deleted` flag), so they sync like any other change.

## Rules the reducer enforces (see DESIGN.md §5–6)

- Each task has at most one open session; several tasks may run at once.
- Projects nest to any depth (`parentId`); the reducer refuses cycles and unknown parents.
- `task.start` mode: `switch` (default) stops others at the same instant and marks them
  **paused** (`task.pausedAt`, they stay on the Now stack); `alongside` doesn't.
- `timer.pause` stops a session and marks its task paused. `timer.stop` (with `sessionId` and/or
  `taskId`, or neither = everything) also clears paused. Starting a task clears it.
  UI: ▶ New and the switcher switch; ▶ on a list row / task details and ▶ Resume on a paused card
  add alongside; Shift inverts.
- Blips (< `settings.blipSec`, default 30 s; no notes; not the task's only session) are discarded
  when they end.
- A task ▶ New made, stopped (`timer.stop`, not pause) with its only session note-less, is
  dropped (`dropIfEmpty`), however long it ran. Inbox tasks, descriptions, entered/pushed stay,
  and so does anything with a ticket, company or work type chosen (a location stamp doesn't count).
- `session.move` moves a session to another task (WRIT on the running card); the task it leaves goes the same way.
- Continuing a task within `settings.resumeGapMin` (default 10) of its last session reopens it,
  unless `task.start` has `fresh` (New entry): that always makes a new session, ending the task's
  running one at the same instant, with `sessionFields` patched on. Changing a profile field
  marked `newEntry` (work type) on a running session ≥ 1 min old asks: new entry or fix this one.
- `session.create` (manual time, end > start), `session.delete` (tombstone; `undo` restores).
  Editing start/end/notes/deduct or a field of an entered session clears `enteredAt` and sets
  `changedSinceEntered`; re-marking entered clears it.
- Settings live in `state.settings` (read with `settingsOf()`; old cached states lack it), change
  via the `settings.update` op, persist as JSON in the server's `meta` table, sync like
  anything else. 0 turns a rule off.
- Merge: same task, earliest start → latest end, non-empty notes joined. UI limits to one day.
  Each field comes from the earliest part that has it.
- Session fields carry over to a task's new session (each from the latest earlier session that
  has it). A fields patch merges key by key; null, "" or false clears a key.
- `session.ext` is integration data (CW: `entryId`, `ticket`, `pushedAt`, `email`): merged per
  integration key by key (null removes), **never** carried over, and changing it doesn't count
  as editing an entered session. A push records its result with a server-made `session.update`
  (`ext` + `enteredAt`).
- Start/stop use timeline semantics, so ops arriving late from an offline phone land correctly.

## UI conventions

- All colors are tokens in `web/src/styles.css` (light + dark). No inline styles for color.
  Dark tokens are keyed on `html[data-theme="dark"]`, which `theme.ts` sets from the per-device
  Colors setting (System / Light / Dark, in localStorage); an inline script in `index.html`
  sets it before the first paint. Never use a `prefers-color-scheme` query in CSS directly.
- Buttons `--tap` (36px), fields beside them `--control` (34px), one shared height and radius
  (Evan chose denser, phone too, 2026-10-14); inputs 16px text (prevents iOS zoom). Focus
  states always visible.
- The top running card's notes editor must stay mounted (cards are keyed by position) and its
  editable element (`notesRef`) be focused synchronously in the tap handler — that's what raises
  the iPhone keyboard. (Was a `<textarea>` until 2026-10-13; check it on the iPhone after
  changes to `RichNotes`.)
- Synced text fields use `DraftInput`/`DraftTextarea`, which reset their draft **during render**
  when the record changes (resetting in an effect let keystrokes leak into the previous record).

## Gotchas

- `tsx watch` hangs under `concurrently` on Windows; the server uses `node --watch --import tsx`.
- `npm i -w <pkg> a b && npm i -D -w <pkg> c` has dropped the first install's entries from
  package.json. Install workspace deps one command at a time and check package.json after.
- `crypto.randomUUID` needs a secure context; use `newId()` from shared (the phone hits http on the LAN).
- `listen EACCES` on a free port = Windows NAT (Hyper-V/WSL) reserved it; ranges re-roll each boot
  (`netsh interface ipv4 show excludedportrange protocol=tcp`). Fixed on the desktop by reserving
  8787 (admin: `net stop winnat`, `netsh int ipv4 add excludedportrange protocol=tcp startport=8787
  numberofports=1`, `net start winnat`). Vite's 5173 needs the same (it fell in a reserved range
  2026-10-12); reserve it the same way. Don't just pick another port; it can be grabbed too.

## Status (2026-11-04)

- **Built 2026-11-04 from Evan's list of what keeps him from reaching for the app.** ▶ Start on the idle card (typing no longer starts the clock); the phone
  toolbar works (WebKit drops a tap's click if `pointerdown` is cancelled, so use `onMouseDown`;
  Edge's touch emulation doesn't show this, Playwright's WebKit does) and fits (no U or link there);
  notes start at two lines; no dashed or dotted outlines anywhere; **find a ticket** in CW (§10);
  **+ Add entry** and following an entry to another day; Entries as a **list** under 1700 px
  (`EntryList.tsx`), calendar a toggle; **🚗 Travel / Arrived** with **location stamps** (§7,
  `location.ts`, profile `travel`); **🎙 dictation** via `gpt-transcribe` (§11); the always-on-top
  **mini window** (§7, `MiniWindow.tsx`).
  **Not yet seen for real, ask how they went:** all of it on the iPhone (the keyboard coming up from
  ▶ Start with the notes box hidden; the mic and location prompts; whether the status bar fade is
  gone, which is a best guess: iOS draws it, so `--top-inset` adds room in the installed app);
  ticket search against live CW, project tickets above all; dictation with a real key (needs
  `OPENAI_API_KEY` on the mini PC; quality is the point of it, so ask).
  Evan is weighing M9 (Tauri); suggested after a few days with the mini window, to see what it
  still lacks. Browser checks can now use WebKit too: `PLAYWRIGHT_BROWSERS_PATH=<scratch> npx playwright-core
  install webkit`.

- **2026-11-02:** the tab title and Home Screen name are "Sideshow" (the header's wordmark
  stays lowercase, Evan's choice). Evan's dev notes of the day are sorted into the backlog
  Inbox; the big new one is the **wrapper entry** (fill the day: workday − real lunch, at
  least 8 h, on the WRIT).

- **Built 2026-10-31:** **notifications** while a timer runs (Settings › Alerts; DESIGN.md
  §7): what's running, reminders for a long timer, the icon badge. **Works on the iPhone**
  (badge and notifications, from Chrome's Home Screen icon). iOS moves a seen notification off
  the lock screen into Notification Center; only a native Live Activity stays pinned (written
  up in DESIGN.md §7, not started). Still to see: reminders, and whether each notification
  replaces the last there.
- **Built 2026-10-29:** **AI note cleanup** (M7, ✨; DESIGN.md §11), Claude and GPT, and
  Settings with sections down the side. Tried against a fake provider only: the desktop's
  `.env` had no AI keys yet, so no real call has been made. First real check: Compare in
  Settings › AI with both keys.
- **Built 2026-10-29:** **dev notes** (🧪, from foodlab; DESIGN.md §7): files, pasted pictures,
  "Include this page" (off by default). The phone's top bar went icon-only to fit it (Holds as
  🗓️, "Synced" as its dot). Browser-checked on a scratch server; not yet on the iPhone.
- **Built 2026-10-29:** **schedule holds** (header › Holds; DESIGN.md §10): repeating Schedule
  Hold entries on Evan's CW calendar, made a day at a time 4 weeks ahead. Live-checked the same
  day (with Evan's OK): create, change incl. clearing the reminder (`reminder: null` PATCH), and
  delete (204) all work. Ask how the first real holds went.

- **Built 2026-10-20:** **workspaces** with a profile each (Settings › Workspaces; DESIGN.md
  §4); the Entries table **edited in place** with CW (dates, times, hours, ticket #, company;
  click-to-copy without an integration); the Day tab's company filter beside the date. Check
  on the mini PC after the update: no `workspaces.json` = just main, nothing changes until a
  workspace is made. Also **Settings › Connections** (the CW settings, edited in `.env`; DESIGN.md
  §10).

- **Built 2026-10-19** from Evan's list (DESIGN.md §7): company filter on the task list (a
  searchable picker, not chips); **Move to…** in the session editor (any task or a new one);
  earlier sessions on the running card open the session editor; the Day page's ✎ became a
  notes cell under Ticket/Company; **Undo** (Ctrl+Z, ↶ on the Day page; `shared/src/undo.ts`,
  `web/src/undo.ts`; actions send ops through `send` so they're recorded); titles wrap
  (`TitleInput`). Fixed: picking from a `ComboPicker` on the iPhone (Safari doesn't focus a
  tapped button, so the list closed on blur before the tap landed; it now closes on a tap
  outside). Check on the iPhone: picking a company, editing a long title.
- **Waiting on Evan:** a ticket per session for CW projects, and two-way sync of pushed entries
  (both proposed in the backlog Inbox).
- **Live** at https://sideshow.evans.tools on the mini PC; hosting, updates and restores are in
  [docs/runbook.md](docs/runbook.md) (Evan deploys with his "Update sideshow" shortcut). Done:
  M1 core app, M2 projects & profiles, M3 Day page (desktop; touch dragging in the backlog), M4
  CW push. Each milestone's status: DESIGN.md §12. History: `git log`.
- **Built 2026-10-12/13** (DESIGN.md §10 unless noted): the CW company picker (the ticket's
  company becomes the task's company); **New ticket…** from a
  task (pushes its time too); delete tasks without a ticket (§5); collapsible Day page groups
  (§7); **rich notes** with attachments pushed to the ticket as documents (§7 "Rich notes");
  Now buttons in the session editor; ↗ / ↻ and "Update ticket" (rename the CW summary) for
  linked tasks. Tried against a fake CW; live so far: company sync, ticket creation, pushes.
- **The task description, settled 2026-11-04:** sideshow-only, its box hidden once a task has a
  ticket (unless it already has text).
- **New entry built (2026-10-13)**, for Evan to try on 2026-10-14: split a running session when
  the work type changes (DESIGN.md §5 Session). Ask how it went before building anything else.
- **▶ WRIT built (2026-10-13)**: finds this week's recurring internal ticket (DESIGN.md §10).
  Since 2026-10-14 it's **WRIT** on the running card (moves the session there), not a header
  button. Same day: empty new tasks are dropped on Stop (§5), note pictures open in an overlay
  (§7, `Lightbox.tsx`). Moving/removing pushed time between tickets is in the backlog, to design with
  Evan.
- **Also queued for 2026-10-14:** the DEV badge (backlog Inbox; the design is settled there).
- **Then:** the ticket / project-ticket picker (M5/M6, backlog). Still to check live: ▶ New
  raising the iPhone keyboard (notes are now an editor), an attachment push to #106745, the
  first real "Update ticket". The iPhone layout pass Evan asked for (desktop first).
- **Before that (2026-10-11).** Day page improvements from the first real day (Oct 7 on the
  live site), Evan to choose the order; suggested 1 and 2 first:
  1. Overlapping sessions: ⚠ on rows and calendar blocks, warn in the push preview, one-click
     trim (the earlier one ends where the next starts). The day total counts overlaps twice.
  2. Work type / billing for a whole task from its header row (fills sessions missing them),
     and for ticked rows from the push bar.
  3. Rows that can't be pushed: a short "needs …" note instead of dimmed Push… / ✓ / ✎.
  4. Tiny entries (< ~5 min): suggest merge or delete. Ask Evan whether CW wants rounding.
  5. Denser rows (padding, not smaller fonts; Evan doesn't want CW-style 8–10pt cramming).
  Also offered: a DEV badge on the dev server (Evan mixed up localhost and the live site).
  Then M5 CW tickets & lists.
- **Evan, around 2026-10-17:** the Cloudflare clean-up under Open items in the runbook.
- Requests and ideas: [docs/backlog.md](docs/backlog.md).
- Compatibility code that can go once nothing old is left anywhere (say after M5): the reducer's
  `upgradeOp` / `LEGACY_KEYS`, reading `FIELDTIME_*` settings, renaming `data/fieldtime.db`,
  pruning `fieldtime-*` backups, carrying over the `fieldtime:pending` outbox, and install.ps1
  reading `FIELDTIME_BACKUP_DIR`. (The scripts' handling of the old `fieldtime` task went
  2026-11-02.)

## Working with Evan

- Commit and push only when asked.
- Prefers the Claude desktop app / claude.ai over the terminal. Give GUI steps, not shell
  commands, where possible.
- Develops on **NOSTROMO** (the desktop, `C:\Dev\sideshow`; `C:\Dev\fieldtime` until 2026-10-10) since 2026-10-06; DEVvm (a Win 11 VM)
  before that. Tests and browser checks are headless (vitest; Playwright + Edge), so they never
  take the screen. The VM is only worth it again for real-window work like M9 (Tauri).
- Uses two Windows PCs and an iPhone 13; the mini PC (Intel N97, Win 11) hosts the real app at
  `C:\Apps\sideshow`, port 8081 (8080 is Caddy's), backups to the NAS. See
  [docs/runbook.md](docs/runbook.md).
