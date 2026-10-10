# Runbook: sideshow on the mini PC

How the real app is hosted, kept running, updated and rebuilt. Written so a Claude Code session
**on the mini PC** can follow it with Evan. Development happens on the desktop (NOSTROMO) and
isn't covered here; see [README.md](../README.md) and [CLAUDE.md](../CLAUDE.md).

Legend: **[Evan]** = needs Evan (dashboard, admin prompt, or a decision). Everything else Claude
can do and check.

## At a glance

| | |
|---|---|
| Machine | Mini PC (Intel N97, Windows 11), always on, Autologon on |
| Code | `C:\Apps\sideshow`, a clone that only pulls `main` (never edit it there) |
| Server | Scheduled task **sideshow** (at startup, as SYSTEM, signed in or not); `scripts\run.cmd` restarts it if it exits |
| Port | **8081**, reached as `127.0.0.1:8081` |
| Address | **https://sideshow.evans.tools** |
| Login | Cloudflare Access app `sideshow` (team `crimson-frog-8dc4`), only Evan's email; `sideshow icons` app lets the icon files through |
| Data | `C:\Apps\sideshow\data\sideshow.db` |
| Backups | Daily to `\\evnas\Junk\Tech\DBBackups\sideshow` (TrueNAS), 30 kept |
| Settings | `C:\Apps\sideshow\.env` (git-ignored) |
| Log | `C:\Apps\sideshow\data\server.log` |

```
 any browser / iPhone
        │  https://sideshow.evans.tools
        ▼
 Cloudflare ── Access: "is this Evan?"  (email code; everyone else stops here)
        │
        │  outbound tunnel that cloudflared keeps open from the mini PC
        ▼
 mini PC: cloudflared ──▶ 127.0.0.1:8080  Caddy: evans.tools landing page (public)
                     ├──▶ 127.0.0.1:8081  sideshow
                     └──▶ mediawall.evans.tools (redirect to GitHub, public)
```

**Already on the mini PC, not part of sideshow** (don't disturb):
- **Caddy** serves the public `evans.tools` landing page on **port 8080** (IPv4 and IPv6): the
  "Start Caddy Server" scheduled task runs
  `C:\caddy\caddy.exe file-server --root C:\sites\evans --listen :8080`.
- **cloudflared** runs as a Windows service: the evans.tools tunnel, shared by every hostname.
- **Always use `127.0.0.1`, not `localhost`.** sideshow listens on IPv4 only, and `localhost`
  can resolve to IPv6 `::1`, which is Caddy's.

## Open items

- **Around 2026-10-17 [Evan], Cloudflare:** remove `fieldtime.evans.tools` (the pre-rename
  address) from the tunnel's public hostnames and from both Access apps, and delete its DNS
  record. First check that daily `sideshow-*.db` files are arriving in `DBBackups\sideshow`;
  then the old `DBBackups\fieldtime` folder can go too.

## Everyday

**Update after a push to `main`** (from the desktop). On the mini PC, admin PowerShell:

```powershell
cd C:\Apps\sideshow
.\scripts\update.ps1
```

It pulls, stops the task, runs `npm ci`, builds, starts the task and checks `/api/health`. The
iPhone app picks up the new build on its next launch (index.html is served `no-cache`). A schema
change copies the database to `data\sideshow.db.before-v<N>.db` before migrating it.

**Health:** `Invoke-RestMethod http://127.0.0.1:8081/api/health` → `ok: True`, the current
`rev` and `lastBackup`.

**Settings** (`.env`). `install.ps1` writes `PORT` and `SIDESHOW_BACKUP_DIR` and keeps every other
line. Added by hand:
- `PROFILE=veritaz-cw`: the job fields (client, ticket #, work type, billing). Without it they're
  hidden, not lost. The log says which profile loaded.
- `CW_*`: ConnectWise credentials, copied from the desktop's `.env`. Without them the ticket
  lookup is off.

Restart after changing `.env`: `Stop-ScheduledTask sideshow; Start-ScheduledTask sideshow`.

**Backups.** The server writes `sideshow-YYYY-MM-DD.db` (a `VACUUM INTO` snapshot) at startup and
at the first hourly check of each new day, keeping 30. The server runs as SYSTEM, which reaches
the NAS as a guest, so the TrueNAS `Junk` share needs **guest access** on. If the share is down,
the log says `backup failed` and it retries hourly; the app keeps running.

**Restore a backup:** `Stop-ScheduledTask sideshow`, copy the backup over `data\sideshow.db`,
delete `data\sideshow.db-wal` and `data\sideshow.db-shm`, `Start-ScheduledTask sideshow`.

**Signed out.** The Access session lasts a month. When it expires, the app's status badge turns
into **Signed out · Sign in**; tapping it goes through the login again. Changes made meanwhile wait
in the outbox, so nothing is lost.

**Reboots** need nothing: the task and cloudflared both start without anyone signed in (tested
2026-10-06; hold Shift during boot to skip Autologon and check).

Record anything that differs from this runbook back in this file, from the desktop (the mini PC's
clone only pulls).

## Rebuild from scratch

The order that was used on 2026-10-06, for a new or reinstalled mini PC.

### 1. Tools

1. `winget install --id Git.Git -e` and `winget install --id OpenJS.NodeJS.LTS -e`.
   **[Evan]** approve the admin prompts. Open a new shell, then check `git --version` and
   `node -v` (must be ≥ 22.13). No C++ build tools are needed (the database is Node's built-in
   `node:sqlite`).
2. **[Evan]** Settings → System → Power: the screen can sleep, the PC **never sleeps**.
3. If PowerShell refuses `npm` ("running scripts is disabled"):
   `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

### 2. Code and server

```powershell
git clone https://github.com/eacartwright/sideshow C:\Apps\sideshow
cd C:\Apps\sideshow
npm ci
npm test
```

**[Evan]** Start → type *PowerShell* → right-click → **Run as administrator**, then:

```powershell
cd C:\Apps\sideshow
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Port 8081 -BackupDir \\evnas\Junk\Tech\DBBackups\sideshow
```

It builds, writes `.env`, registers the **sideshow** task, opens the port on private networks,
starts it, and ends with `sideshow is up on http://127.0.0.1:8081 (rev …, last backup: …)`.
Re-running it later without arguments keeps the port and backup folder. Then add `PROFILE` and
`CW_*` to `.env` (see Settings above) and restart. To bring the data across, restore the latest
backup (see above).

### 3. Cloudflare (all [Evan], in the dashboard; Claude reads the steps out)

**3a. Zero Trust.** Team `crimson-frog-8dc4`, Free plan (it may ask for a card anyway).

**3b. The login, before anything is public.** Zero Trust → **Access → Applications → Add an
application → Self-hosted**:
- Name `sideshow`, session duration **1 month** (the longest, so the phone rarely asks).
- Hostname (type **Public DNS**): subdomain `sideshow`, domain `evans.tools`. One app per
  private hostname, not `*.evans.tools`, because the landing page and mediawall stay public.
- Policy: name `Evan`, action **Allow**, Include → **Emails** → Evan's email address.
- Login method: **One-time PIN** (default).

**3c. The tunnel.** If cloudflared is already a service (`Get-Service cloudflared` → Running),
reuse it. Otherwise: Zero Trust → **Networks → Tunnels → Create a tunnel → Cloudflared**,
`winget install --id Cloudflare.cloudflared -e`, then in an admin PowerShell
`cloudflared.exe service install <TOKEN>`. The token is a secret: Evan pastes it, and it is never
saved in the repo.

**3d. The hostname.** The tunnel → **Public hostnames → Add a public hostname**: subdomain
`sideshow`, domain `evans.tools`, service type **HTTP**, URL **`127.0.0.1:8081`**.

**3e. Public icons.** iOS fetches the home-screen icon without the Access cookie, so behind the
login it gets the login page and draws a plain letter. Add another Self-hosted app, `sideshow
icons`, with one public hostname per file on `sideshow.evans.tools`, paths `apple-touch-icon.png`,
`icon.svg`, `icon-192.png`, `icon-512.png`, `manifest.webmanifest`; policy `Public icons`, action
**Bypass**, include **Everyone**. The more specific paths win over the `sideshow` app.

### 4. Verify

- `Invoke-WebRequest https://sideshow.evans.tools -MaximumRedirection 0` (and `/api/health`) →
  **302 to `crimson-frog-8dc4.cloudflareaccess.com`**. A 200 means the app is public: stop and
  fix the Access app (3b).
- The five icon paths from 3e → 200 without login; `/`, `/index.html`, `/api/state` still 302.
- `https://evans.tools` → 200; `mediawall.evans.tools` still redirects.
- **[Evan]** Desktop browser: the address → email code → the app, status **Synced**.
- **[Evan]** iPhone: Safari → the address → sign in → **Share → Add to Home Screen**. If the
  icon is a plain letter, delete it and add it again after 3e (iOS keeps the old one).

## Why this setup

- **No port forward.** cloudflared connects *out* to Cloudflare. The router, the home IP and
  dynamic DNS don't matter, and nothing on the home network is exposed to the internet.
- **The login is Cloudflare Access, not app code.** A new app is protected before it has any
  auth of its own.
- **HTTPS is automatic**, which the iPhone home-screen app needs. Cost: the domain (~$10/yr);
  Tunnel and Access are free for one person.
- **Rejected:** port forwarding (exposes an unauthenticated server, needs certificates and
  dynamic DNS); Tailscale Funnel (public, no login gate); Supabase or Cloudflare Pages (rewrite
  the server per platform; v1 was Supabase). The trade-off of home hosting: if home power or
  internet is down, the app is unreachable from outside. The outbox keeps sideshow usable
  offline and syncs later.

Things to know:
- **Live sync through the tunnel:** Cloudflare drops connections idle for 100 s; the server's
  SSE ping every 25 s keeps them open.
- **On the home network the app is open** at `http://<mini PC>:8081` without a login. Fine for a
  home LAN; the API token planned in DESIGN.md §9 would close it.

### Another app on the same machine

Same pattern: code in `C:\Apps\<app>` (a clone that only pulls `main`), the next free port
(8082, …) on `127.0.0.1`, a scheduled task named after the app, data and daily backups inside its
folder, settings in its `.env`, then its own Access app (3b) **before** its tunnel hostname (3d).

## History

- 2026-10-06: deployed as **fieldtime** at fieldtime.evans.tools.
- 2026-10-10: renamed to **sideshow** (folder, task, address, backups) together with the
  projects & profiles update (M2). The step-by-step is in git history: `docs/deploy-evans-tools.md` §7, up to commit
  `3988c25`. Only the Cloudflare clean-up under Open items is left.
- Until 2026-10-10 this runbook was three files: `deploy-evans-tools.md` (this one),
  `home-hosting.md` (the rationale) and `mini-pc-setup.md` (an abandoned plan to develop on the
  mini PC, superseded 2026-10-04).
