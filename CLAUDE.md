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
  CW is optional: the server enables it only when `CW_SITE` is set and the profile has a
  `connectwise` section (`config.cw` in `/api/state`; the UI hides CW features otherwise). `npm run dev` loads the root `.env`. Endpoint so far:
  `GET /api/cw/tickets/:id` → `{summary, company, companyId, closed}`;
  `GET /api/cw/boards` → service boards with types/statuses + the owner;
  `POST /api/cw/tickets {taskId, summary, boardId, typeId?, statusId?, assign, description?,
  pushSessionIds?}` → `{ticketId, pushed?}` (`tickets.ts`; writes the number onto the task, then
  pushes those sessions). The client retries CW's 429s after the wait CW asks for;
  `GET /api/cw/weekly` (+ `POST …/refresh`) → this week's recurring internal ticket (▶ WRIT,
  `weekly.ts`); `POST /api/cw/tickets/:id/summary` → rename a ticket;
  `GET /api/cw/companies` (+ `POST …/refresh[?full=1]`) → the cached CW companies, duplicates
  marked (`companies.ts`; the browser keeps a copy, `web/src/companies.ts`); `POST /api/cw/push {sessionIds}` →
  per-session results (`integrations/connectwise/push.ts`; needs `CW_MEMBER` in `.env`, else
  `config.cwPush` is false and the UI shows Mark entered only). Ticket lookup: entering a ticket #
  fetches it once the number settles and records it with the `task.refInfo` op, which is ignored
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
- `packages/web` — React + Vite. `sync.ts`: view = server state + pending ops replayed through the
  same reducer; pending ops persist in localStorage before sending (the outbox).
- **Notes are Markdown** (DESIGN.md §7 "Rich notes"): edited in `RichNotes` (TipTap; Markdown
  setup in `web/src/markdown.ts`, round-trip tests in `markdown.test.ts`; single line breaks
  stay line breaks so old plain notes are unchanged). Show notes as text with `plainNote`.
  Attachments: `POST /api/files` → `server/src/files.ts` (`data/files/`, backed up); a push
  uploads a note's files to the ticket first (`connectwise/documents.ts`) and `cwNotes` rewrites
  the note for CW.

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
  dropped (`dropIfEmpty`), however long it ran. Inbox tasks, descriptions, entered/pushed stay.
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

## Status (2026-10-14)

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
- **Next, Evan's pick (2026-10-13): the task description.** Backlog Inbox, "Task description":
  keep it sideshow-only scratch space (recommended), say so in its placeholder and in New
  ticket…, maybe show the ticket's own initial description read-only.
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
  removing the old `fieldtime` task.

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
