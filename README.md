# Sideshow

A personal work log: frictionless start/stop and note-taking for whatever you're working on,
on desktop and phone. See [DESIGN.md](DESIGN.md) for the full design.

The April 2026 React/Supabase version was removed on 2026-10-06; it's in git history as `v1/` up to
commit `85996a4` (e.g. `git show 85996a4:v1/src/App.jsx`).

## Run it

Requires Node 24+.

```sh
npm install
npm run dev
```

- Desktop: http://localhost:5173
- Phone (same Wi-Fi): `http://<this PC's IP>:5173`. Vite prints the Network URLs on startup.
  If the phone can't connect, set the PC's network to **Private** (Settings → Network & internet →
  your connection → Network profile type); Windows Firewall only lets Node in on private networks.
  In a VM, the network adapter must be **bridged**, not NAT.
- PowerShell refusing to run `npm` ("running scripts is disabled"): run
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or use Command Prompt.

Data lives in `data/sideshow.db` (SQLite, git-ignored). Set `SIDESHOW_DB` to use another file.
The server also writes a daily copy to `data/backups/` (or `SIDESHOW_BACKUP_DIR`), keeping 30.

## Deploy

The always-on copy runs on a home mini PC behind Cloudflare Tunnel + Access; see
[docs/runbook.md](docs/runbook.md). In short, on that PC (admin PowerShell, in
`C:\Apps\sideshow`): `scripts\install.ps1` once, then `scripts\update.ps1` after each push to `main`.

## Using it

| Action | Desktop | Phone |
|---|---|---|
| Start a new task (pauses what's running) | **Alt+N** or ▶ New | ▶ New (bottom bar) |
| Start a new task alongside | **Alt+Shift+N** or Shift+▶ New | + Also working on… |
| Just start typing when nothing is running | click the notes box | tap the notes box |
| Continue a task from the list (adds to what's running) | ▶ on the row (Shift+click = switch to just this) | ▶ on the row |
| Find / switch to any task | **Ctrl+K** or **/** (Shift+Enter = alongside) | Find |
| Pause (clock stops, task stays on screen) | **Alt+P** (top card), **Alt+Shift+P** (all) | ❚❚ Pause on the card, ❚❚ Pause all |
| Resume a paused task (adds to what's running) | ▶ on the paused card (Shift+click = switch) | ▶ on the paused card |
| Stop (clock stops, task leaves the Now stack) | ■ on the card, Stop all | ■ on the card, Stop all |
| Add to inbox (don't start) | **Alt+I** | + Inbox |
| Time entries to copy into ConnectWise | **Alt+E** or Entries | Entries |
| Settings | ⚙ | ⚙ |

- A task has no title until you give it one; the first line of your notes stands in.
- A session left with empty notes counts as "continuation of previous work".
- Switching to another task pauses the old one; it stays on the Now stack until you stop it.
- Sessions under 30 seconds with no notes are discarded (except a task's first), and continuing
  a task within 10 minutes reopens the same session. Both are adjustable (or off) in ⚙ Settings.
- **Entries** (Alt+E) opens the full-width time entries page: the day's calendar on the left, and
  one row per session, grouped by ticket, with Date, Start, End, Hours, Work Type, Billing
  (B | NB | NC); click a value to copy it (notes: hover ✎, or open the task). **Mark entered** once it's in CW; "To enter"
  shows what's left. Esc goes back.
- With ConnectWise set up (`CW_*` and `CW_MEMBER` in `.env`), **Push…** sends an entry to its
  ticket as a CW time entry: per row, per ticket (**Push all**), or tick rows and push those.
  A preview shows what will go first. **Notes to** (Internal | Discussion, Internal by default)
  and **✉ Email** (off by default) are set per entry. Edit a pushed entry and **Update…** fixes
  the same CW entry. The ticket # (↗) opens the ticket in CW.
- On the calendar (mouse): drag a block to move it, drag its top or bottom edge to resize it
  (15-minute steps, Alt for 1 minute, Esc cancels, Undo in the toast), and drag across empty
  space to add time to a task or a new one. Gaps are shaded.
- Merge sessions in task details: tap one, tap another, and everything between is selected.

## Layout

```
packages/
  shared/   data model, ops, the reducer that enforces "one thing running", derived views (+ tests)
  server/   Node + Hono + SQLite: applies ops, persists, pushes live updates (SSE)
            integrations/connectwise: CW API client + `npm run cw` dev CLI (creds in .env)
  web/      React + Vite UI, local copy + outbox so nothing waits on the network
scripts/    install.ps1 / update.ps1 / run.cmd for the always-on server
docs/       runbook (hosting the real app) and backlog
```

```sh
npm test          # reducer tests
npm run typecheck
```
