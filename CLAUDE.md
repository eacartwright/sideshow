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
  `GET /api/cw/tickets/:id` → `{summary, company, closed}`.
- **Profiles** (DESIGN.md §4): job fields are declared in `packages/server/profiles/<name>.json`,
  chosen with `PROFILE` in `.env` (no PROFILE = no job fields; stored values stay, hidden). Types
  and validation in `shared/src/profile.ts`; the server loads it at startup (`server/src/profile.ts`,
  a bad profile stops the server), seeds empty lists from it, and sends it as `config.profile`.
  Values live in `task.fields` / `session.fields` (`Fields`, unset = absent); list items (clients,
  work types) are `state.lists` (`ListItem`, `list` says which). UI renders fields generically
  (`FieldInput`, `TaskFieldInputs`, `SessionFieldInputs` in `fields.tsx`); Time entries follows
  `entryFormat`. A new field is a profile edit, not a code change.
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

## Status

- Done: M1 core loop — ▶ New / continue / alongside / stop, stacked running cards, switcher
  (Ctrl+K), inbox, task detail with merge, live sync, outbox.
- Done: **Pause** (prominent; keeps tasks on the Now stack as paused cards) vs **Stop** (takes
  them off).
- Done: **Editing** — one `SessionEditor` (date, start/end, deduct, work type, notes, snap 15,
  delete+undo) in Task details and Time entries; + Add time; Merge… mode in both.
- Done: **Time entries** sheet (Alt+E): per-session CW fields, click-to-copy, To enter / By day,
  Mark entered (`session.enteredAt`).
- Deploy kit done and rehearsed on DEVvm: daily backups, `/api/health`, cache headers, PNG
  icons, "Signed out" detection, `scripts/install.ps1` / `update.ps1` / `run.cmd`.
- Started M5 groundwork: CW client + dev CLI (ported from the Python `psainteract` prototype, whose
  company/ticket reads worked against the live instance). Note writes verified 2026-10-06
  on test ticket #106745 (`npm run cw -- note`, Internal, no notifications).
- Done 2026-10-06: live on the mini PC (as fieldtime.evans.tools; **https://sideshow.evans.tools** after the rename) behind Cloudflare
  Access ([docs/deploy-evans-tools.md](docs/deploy-evans-tools.md); iPhone home-screen app and
  reboot test done; CW lookup on).
- Done (M5): **ticket lookup** — entering a ticket # (Task details, Time entries) fetches it from
  CW once the number settles; `TicketInfo` shows summary · company with ↻. The result is the
  `task.refInfo` op: ignored if the ref changed since, fills the title only if untitled and the
  client only if unset (matched by exact name). Changing the ref clears `refInfo`.
- Requested changes and ideas: [docs/backlog.md](docs/backlog.md) (Inbox, then Next / Soon / Later).
- 2026-10-10: design reworked into **core / profile / integration** (DESIGN.md §4, §10) with
  core **projects** (any depth) and CW items tracked only when chosen. Milestones renumbered:
  M5 Projects & profiles, M6 CW tickets & lists, M7 CW projects, M8 CW write, M9 AI, M10
  scratchpad. The ticket lookup above counts toward M6.
- M5 plan (agreed 2026-10-10), three steps: (1) projects, (2) profile engine + migrating
  client / work type / ticket # into the CW profile (`fields` blob, `list_items` keeping ids,
  reducer translates old op shapes still queued on devices; profile = repo JSON chosen by
  `PROFILE` in `.env`), (3) generic `FieldInput`, `entryFormat`-driven Time entries, Billing
  field. Work types carry a **billing default** (code ready for it; Evan supplies the values).
- Done (M5 step 1): **projects** — `Project` (any depth, `parentId`; the reducer refuses
  cycles and unknown parents), `task.projectId`, ops `project.create` / `project.update`,
  migration 7. UI: Projects tab (tree) → project page (crumbs, parent picker, subprojects,
  tasks / inbox / done, ▶ New here, inline add); `ProjectPicker` on the Now card, Task details
  and + Inbox; project path in rows and switcher search. Task details opened from a project
  page returns to it.
- Done (M5 step 2, most of step 3): **profiles** — migration 8 moved client / ticket # / work
  type into `fields` and `list_items` (ids kept; old columns unused); `profiles/veritaz-cw.json`;
  generic field UI everywhere (Now card and + Inbox now have Ticket # too); Time entries from
  `entryFormat`; old queued ops upgraded by the reducer; pre-migration DB copy. Checked on a
  seeded v7 copy with the CW profile and with none.
- Done 2026-10-10: **renamed to sideshow** in code, scripts and docs (packages `@sideshow/*`,
  `data/sideshow.db`, `SIDESHOW_*` settings, task `sideshow`). Compatibility kept on purpose:
  `FIELDTIME_*` settings still read, `data/fieldtime.db` renamed on first start, `fieldtime-*`
  backups still pruned, `fieldtime:pending` outbox carried over, install.ps1 removes the old task.
  GitHub repo renamed to `eacartwright/sideshow` the same day.
- Done 2026-10-10 (M5 complete): **Billing** session field (Billable / Do Not Bill / No Charge,
  CW's names) with a default per work type in the profile. The reducer applies a chosen list
  item's `defaults` (unless the same change sets that field); the server fills missing defaults
  once when the profile's defaults change. Migrations 7–8 checked on the mini PC's 2026-10-10
  backup (v6): counts equal, every client / ticket / work type value carried over, billing filled.
- Deployed 2026-10-10 (runbook §7): mini PC at `C:\Apps\sideshow`, task `sideshow`, live at
  **https://sideshow.evans.tools** (Access + icon bypass + tunnel), iPhone re-added. Server log
  confirmed the DB rename, the CW profile and billing filled on 3 sessions.

- Done 2026-10-10 (backlog quick wins): Mark done closes Task details; an untitled task's Title
  field shows the notes' first line as editable text (`TaskInfo.titleText`); Done has a
  collapsed Archived section (`model.all` includes archived); the Today tab is now **Day** and picks any day
  (`DayNav`, shared with Time entries' By day; `taskTotals(info, now, day).onDay`); "Started
  9:12" on the running card opens a start-time control (time, −5 / +5 min);
  `scrollbar-gutter: stable` on the page and scroll areas.

### Where we left off (2026-10-10)

1. **Desktop folder rename** (Evan, between sessions): `C:\Dev\fieldtime` → `C:\Dev\sideshow`.
   Claude's per-project memory moves with the path: it was copied to
   `%USERPROFILE%\.claude\projects\C--Dev-sideshow\memory\` ahead of time. After the rename,
   delete `node_modules` and run `npm ci` if anything complains about paths.
2. **Cleanup, around 2026-10-17** (Evan, Cloudflare): remove `fieldtime.evans.tools` from the
   tunnel's public hostnames and from both Access apps, and its DNS record. First check that
   daily `sideshow-*.db` backups are landing in `\\evnas\Junk\Tech\DBBackups\sideshow`; then
   the old `DBBackups\fieldtime` folder can go.
3. ~~Quick wins~~ done 2026-10-10 (see Status).
4. **Next, a milestone** (DESIGN.md §12), Evan to pick: **M6 CW tickets & lists** (live ticket
   search + Track, client ↔ CW company mapping, work-type sync carrying billing defaults) or
   **M1.5 Day calendar** (drag/resize sessions, fill gaps). The compatibility code for the
   rename and for pre-profile ops (`LEGACY_KEYS`, `FIELDTIME_*`, `fieldtime:pending`) can be
   removed once nothing old is left anywhere, say after M6.

## Working with Evan

- Commit and push only when asked.
- Prefers the Claude desktop app / claude.ai over the terminal. Give GUI steps, not shell
  commands, where possible.
- Develops on **NOSTROMO** (the desktop, `C:\Dev\sideshow`; `C:\Dev\fieldtime` until 2026-10-10) since 2026-10-06; DEVvm (a Win 11 VM)
  before that. Tests and browser checks are headless (vitest; Playwright + Edge), so they never
  take the screen. The VM is only worth it again for real-window work like M3 (Tauri).
- Uses two Windows PCs and an iPhone 13; the mini PC (Intel N97, Win 11) hosts the real app at
  `C:\Apps\sideshow`, port 8081 (8080 is Caddy's), backups to the NAS. See
  [docs/deploy-evans-tools.md](docs/deploy-evans-tools.md).
