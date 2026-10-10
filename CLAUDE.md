# sideshow — notes for Claude

A personal work log for an MSP tech: frictionless start/stop of tasks plus quick notes, on
Windows desktops and an iPhone. **[DESIGN.md](DESIGN.md) is the spec**; read the relevant section
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
  `GET /api/cw/tickets/:id` → `{summary, company, closed}`. Ticket lookup: entering a ticket #
  fetches it once the number settles and records it with the `task.refInfo` op, which is ignored
  if the ref changed since, fills the title only if untitled and the client only if unset
  (matched by exact name). Changing the ref clears `refInfo`.
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
- Continuing a task within `settings.resumeGapMin` (default 10) of its last session reopens it.
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
- Start/stop use timeline semantics, so ops arriving late from an offline phone land correctly.

## UI conventions

- All colors are tokens in `web/src/styles.css` (light + dark). No inline styles for color.
- Tap targets ≥ 44px; inputs 16px (prevents iOS zoom). Focus states always visible.
- The top running card's notes `<textarea>` must stay mounted (cards are keyed by position) and
  be focused synchronously in the tap handler — that's what raises the iPhone keyboard.
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
  numberofports=1`, `net start winnat`). Don't just pick another 8xxx port; it can be grabbed too.

## Status (2026-10-10)

- **Live** at https://sideshow.evans.tools on the mini PC; hosting, updates and restores are in
  [docs/runbook.md](docs/runbook.md). Done: M1 core loop, M5 projects & profiles, M6's ticket
  lookup, the backlog quick wins. Each milestone's status: DESIGN.md §12. History: `git log`.
- **Next: M1.5, the Day page** (DESIGN.md §7 "Day page"; desktop-first, §2 principle 7). Build
  order: (1) the full-width page and entries table, with the `B | NB | NC` billing control,
  replacing the Time entries dialog; (2) the calendar, read-only, linked to the table; (3) drag
  to move and resize; (4) drag across empty space to add time. Custom component, no library.
- **Evan, around 2026-10-17:** the Cloudflare clean-up under Open items in the runbook.
- Requests and ideas: [docs/backlog.md](docs/backlog.md).
- Compatibility code that can go once nothing old is left anywhere (say after M6): the reducer's
  `upgradeOp` / `LEGACY_KEYS`, reading `FIELDTIME_*` settings, renaming `data/fieldtime.db`,
  pruning `fieldtime-*` backups, carrying over the `fieldtime:pending` outbox, and install.ps1
  removing the old `fieldtime` task.

## Working with Evan

- Commit and push only when asked.
- Prefers the Claude desktop app / claude.ai over the terminal. Give GUI steps, not shell
  commands, where possible.
- Develops on **NOSTROMO** (the desktop, `C:\Dev\sideshow`; `C:\Dev\fieldtime` until 2026-10-10) since 2026-10-06; DEVvm (a Win 11 VM)
  before that. Tests and browser checks are headless (vitest; Playwright + Edge), so they never
  take the screen. The VM is only worth it again for real-window work like M3 (Tauri).
- Uses two Windows PCs and an iPhone 13; the mini PC (Intel N97, Win 11) hosts the real app at
  `C:\Apps\sideshow`, port 8081 (8080 is Caddy's), backups to the NAS. See
  [docs/runbook.md](docs/runbook.md).
