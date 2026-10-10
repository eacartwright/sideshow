# Runbook: sideshow on the mini PC at sideshow.evans.tools

The concrete version of [home-hosting.md](home-hosting.md) for this setup. Written so a Claude Code
session **on the mini PC** can follow it with Evan. **Deployed 2026-10-06** as fieldtime at
fieldtime.evans.tools, renamed to sideshow 2026-10 (§7); this file records how it was actually
done, so it doubles as the rebuild guide.

| | |
|---|---|
| Machine | Mini PC (Intel N97, Windows 11), always on |
| Code | `C:\Apps\sideshow`, a clone that only pulls `main` (never edit it there) |
| Port | **8081**, reached as `127.0.0.1:8081`. 8080 belongs to Caddy (see below). |
| Address | **https://sideshow.evans.tools** |
| Login | Cloudflare Access app `sideshow` on `sideshow.evans.tools` only (team `crimson-frog-8dc4`) |
| Data | `C:\Apps\sideshow\data\sideshow.db`, daily backups to `\\evnas\Junk\Tech\DBBackups\sideshow` (TrueNAS) |

Development happens on the desktop (NOSTROMO); its data does **not** move here, so the real log
started empty.

**Already on the mini PC before sideshow** (don't disturb):
- **Caddy** serves the public `evans.tools` landing page on **port 8080** (IPv4 and IPv6): the
  "Start Caddy Server" scheduled task runs
  `C:\caddy\caddy.exe file-server --root C:\sites\evans --listen :8080`.
- **cloudflared** runs as a service: the existing evans.tools tunnel. `mediawall.evans.tools` is
  on it too (redirects to the GitHub page) and stays public.
- **Always use `127.0.0.1`, not `localhost`.** sideshow listens on IPv4 only, and `localhost`
  can resolve to IPv6 `::1`, which is Caddy's.

Legend: **[Evan]** = needs Evan (dashboard, admin prompt, or a decision). Everything else Claude
does and checks.

## 1. Tools

1. `winget install --id Git.Git -e` and `winget install --id OpenJS.NodeJS.LTS -e`.
   **[Evan]** approve the admin prompts. Then open a new shell (PATH) and check `git --version`,
   `node -v` (must be ≥ 22.13; LTS is 24).
2. **[Evan]** Settings → System → Power: screen can sleep, but the PC **never sleeps** (was
   already set).

## 2. Code and build

```powershell
git clone https://github.com/eacartwright/sideshow C:\Apps\sideshow
cd C:\Apps\sideshow
npm ci
npm test
npm run build
```

No C++ build tools are needed (the database is Node's built-in `node:sqlite`). If `npm` is refused
in PowerShell ("running scripts is disabled"): `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## 3. Install the always-on server

The backups go to the NAS. The server runs as SYSTEM, which reaches the share as a guest, so
**[Evan]** the TrueNAS `Junk` SMB share needs **guest access** on (without it, mkdir failed with
`EPERM`). The server keeps running if the share is down; it logs `backup failed` and retries hourly.

**[Evan]** Start → type *PowerShell* → right-click → **Run as administrator**, then:

```powershell
cd C:\Apps\sideshow
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Port 8081 -BackupDir \\evnas\Junk\Tech\DBBackups\sideshow
```

It writes `PORT` and `SIDESHOW_BACKUP_DIR` to `.env` (other lines are kept), registers the
**sideshow** scheduled task (at startup, as SYSTEM, signed in or not; `scripts\run.cmd` restarts
the server if it exits), opens the port on private networks, starts it, and ends with
`sideshow is up on http://127.0.0.1:8081 (rev …, last backup: sideshow-YYYY-MM-DD.db)`.
Re-running it later without arguments keeps the port and backup folder from `.env`.

Check: `Invoke-RestMethod http://127.0.0.1:8081/api/health` → `ok: True` and a `lastBackup`.
Logs: `C:\Apps\sideshow\data\server.log`.

## 4. Cloudflare (all [Evan], in the dashboard; Claude reads the steps out)

**4a. Zero Trust.** Already set up: team `crimson-frog-8dc4`, Free plan.

**4b. The login first, before anything is public.** Zero Trust → **Access → Applications → Add
an application → Self-hosted**:
- Application name: `sideshow`
- Session duration: **1 month**
- Hostname (type **Public DNS**): subdomain `sideshow`, domain `evans.tools`. One app per
  private hostname, not `*.evans.tools`, because mediawall and the landing page stay public.
- Policy: name `Evan`, action **Allow**, Include → **Emails** → Evan's email address.
- Login methods: **One-time PIN** (default); add Google if wanted.
- Save.

**4c. The tunnel.** Use the existing one (cloudflared is already a service; `Get-Service
cloudflared` → Running). Only on a fresh machine: Zero Trust → **Networks → Tunnels → Create a
tunnel → Cloudflared**, install with `winget install --id Cloudflare.cloudflared -e`, then in an
admin PowerShell `cloudflared.exe service install <TOKEN>` (Evan pastes the token; it's a secret,
never save it in the repo).

**4d. The hostname.** In the tunnel → **Public hostnames → Add a public hostname**:
subdomain `sideshow`, domain `evans.tools`, service type **HTTP**, URL **`127.0.0.1:8081`**. Save.

**4e. Public icons.** iOS fetches the home-screen icon without the Access cookie, so behind the
login it gets the login page and draws a plain letter "F". Zero Trust → **Access → Applications →
Add an application → Self-hosted**, name `sideshow icons`, one public hostname per file on
`sideshow.evans.tools` with path `apple-touch-icon.png`, `icon.svg`, `icon-192.png`,
`icon-512.png`, `manifest.webmanifest`; policy `Public icons`, action **Bypass**, include
**Everyone**. The more specific paths win over the `sideshow` app. Then remove and re-add the
home-screen icon on the iPhone (iOS keeps the old one).

## 5. Verify

Done 2026-10-06 unless marked.

- `Invoke-WebRequest https://sideshow.evans.tools -MaximumRedirection 0` (and `/api/health`)
  → **302 to `crimson-frog-8dc4.cloudflareaccess.com`** (the login is in front). A 200 here would
  mean the app is public: stop and fix the Access app (4b).
- `https://evans.tools` → 200, public; `mediawall.evans.tools` still redirects.
- The five icon paths from 4e → 200 without login; `/`, `/index.html`, `/api/state` still 302.
- **[Evan]** Desktop browser: https://sideshow.evans.tools → email code → the app loads.
- **[Evan]** *Not done yet:* start and stop a task; status "Synced".
- **[Evan]** iPhone: Safari → same address → sign in → **Share → Add to Home Screen**: the
  sideshow icon (after 4e).

## 6. Afterwards

- **Updates:** after pushing to `main` from the desktop, on the mini PC in an admin PowerShell:
  `cd C:\Apps\sideshow; .\scripts\update.ps1` (pull, stop, install, build, start, health check).
  - **The first update after 2026-10-06** must be `git pull; .\scripts\update.ps1 -NoPull`: the
    copy of update.ps1 already on the machine ran `npm ci` with the server still up, which fails
    with `EPERM unlink …esbuild.exe`. Pulling first makes it run the fixed script.
- **Reboot test:** passed 2026-10-06 (restart, then load the site from the phone). The mini PC
  has **Autologon** on; the server (scheduled task, SYSTEM) and cloudflared (service) don't
  need it. To test without it, hold Shift while Windows boots.
- **Restore a backup:** stop the task (`Stop-ScheduledTask sideshow`), copy a backup over
  `data\sideshow.db`, delete `data\sideshow.db-wal` and `-shm`, `Start-ScheduledTask sideshow`.
- **ConnectWise** (M5 onward): add the `CW_*` lines from the desktop's `.env` to
  `C:\Apps\sideshow\.env` by hand; install.ps1 and update.ps1 leave them alone.
- **Profile** (from M5 step 2): add `PROFILE=veritaz-cw` to `C:\Apps\sideshow\.env` by hand.
  Without it the server runs with no job fields: client, ticket # and work type are hidden (not
  lost). The server log says which profile it loaded. The first start after updating also
  copies the database to `data\sideshow.db.before-v<N>.db` (N = the first new version) before
  changing it.
- Record anything that differed from this runbook back in this file (from NOSTROMO; the mini PC's
  clone only pulls).

## 7. Rename fieldtime → sideshow (one time, 2026-10)

Ships with M5 (projects and profiles), so this is also that update. The code copes with every
half-done state: the server reads `FIELDTIME_*` settings and renames `data\fieldtime.db` to
`sideshow.db` itself; `update.ps1` uses whichever task exists; `install.ps1` removes the old task
and firewall rule. What can't move by itself is **the browser's data**: a new address is a new
origin, so changes still waiting in the old address's outbox would stay there.

1. **[Evan] Sync first.** On the iPhone and the desktop browser, open the old app
   (fieldtime.evans.tools) and check it says **Synced**, not "N unsent". Then don't log anything
   until step 6.
2. **GitHub:** the repo was renamed to `sideshow` on 2026-10-10 (GitHub redirects the old URL,
   so the mini PC's pull works either way). Step 3 points the clone at the new URL.
3. **Mini PC, admin PowerShell.** Stop the server, move the folder, and set up under the new name:
   ```powershell
   cd C:\Apps\fieldtime
   git pull --ff-only
   Stop-ScheduledTask fieldtime
   Get-CimInstance Win32_Process -Filter "Name = 'cmd.exe'" |
     Where-Object { $_.CommandLine -like "*C:\Apps\fieldtime\scripts\run.cmd*" } |
     ForEach-Object { taskkill /T /F /PID $_.ProcessId }
   cd C:\
   Rename-Item C:\Apps\fieldtime sideshow
   cd C:\Apps\sideshow
   git remote set-url origin https://github.com/eacartwright/sideshow
   Add-Content .env "PROFILE=veritaz-cw"
   powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -BackupDir \\evnas\Junk\Tech\DBBackups\sideshow
   ```
   Expect: "removing the old 'fieldtime' task", the build, then `sideshow is up on
   http://127.0.0.1:8081`. `data\server.log` should show `renamed …fieldtime.db to …sideshow.db`,
   `profile: Veritaz / ConnectWise` and `profile lists: 12 items updated, defaults filled on …`;
   `data\sideshow.db.before-v7.db` is the copy from before the M5 migrations (the mini PC was
   on v6; checked on its 2026-10-10 backup: all values carried over, billing filled in). `.env` now has `SIDESHOW_BACKUP_DIR` instead of `FIELDTIME_BACKUP_DIR`.
   Old `fieldtime-*.db` backups stay in `DBBackups\fieldtime`; delete that folder whenever.
4. **[Evan] Cloudflare.** Login before address, as in §4:
   - Access → Applications → `fieldtime`: rename to `sideshow`, **add** hostname
     `sideshow.evans.tools` (keep the old one for now). Same for `fieldtime icons`: rename, and
     add the five icon paths on `sideshow.evans.tools`.
   - Tunnel → Public hostnames → add `sideshow.evans.tools` → HTTP `127.0.0.1:8081`.
5. **Verify** as in §5 with the new name: `https://sideshow.evans.tools` → 302 to the login;
   icon paths → 200.
6. **[Evan] Devices.** iPhone: delete the old home-screen icon, open https://sideshow.evans.tools
   in Safari, sign in, Share → Add to Home Screen. Desktop: bookmark the new address.
7. **Later (a week or so):** remove `fieldtime.evans.tools` from the tunnel and both Access
   apps, and its DNS record.
