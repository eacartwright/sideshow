# Mini PC as the dev machine

> **Superseded (2026-10-04):** development moved to **DEVvm**, a Windows 11 VM in VMware
> Workstation on the desktop, and on 2026-10-06 to the desktop itself (NOSTROMO), at
> `C:\Dev\sideshow`. The mini PC only *hosts* the real app ([home-hosting.md](home-hosting.md)).
> The remote-access notes below still apply if you reach the dev machine from other devices.

The mini PC (Intel N97, Windows 11, always on) is the **one place sideshow is developed**. Code,
dev servers, the scratch DB and every Claude Code conversation live there. The laptop, desktop and
iPhone are windows onto it. Nothing gets copied between machines.

Why: a Claude Code conversation is stored on the machine that ran it
(`%USERPROFILE%\.claude\projects\C--Dev-sideshow\`). It can't follow you to another PC, and
syncing those files with git or Syncthing is fragile. Claude also has to sit next to the running
app to start it, test it and read its logs. So keep one host and reach it from everywhere else.

## How each device connects

| Device | Talk to Claude | Look at / edit code | Test the app |
|---|---|---|---|
| Mini PC (at it, or via RDP) | Claude desktop app, Code tab | VS Code | `http://localhost:5173` |
| Laptop / desktop | claude.ai/code in a browser (Remote Control session) | VS Code → Remote-SSH to the mini PC | `http://<minipc>:5173` over Tailscale |
| iPhone | Claude app → **Code** | — | Safari → `http://<minipc>:5173` |

- **Remote Control** keeps the conversation in sync: every message and tool call shows on
  every connected device, and you can type from whichever one you're on. The session still
  *runs* on the mini PC, so the Claude desktop app there must stay open.
- **Starting a new session** happens on the mini PC: open the desktop app there (in person or over
  RDP) and click New session. With "Enable remote control by default" on, it shows up on the
  other devices right away. (From the phone you can also use Dispatch in the Claude app.)
- **The desktop app's SSH environments won't work for this.** They need a Linux or macOS
  remote, and the mini PC runs Windows.
- **Cloud sessions** (claude.ai/code without Remote Control) run in Anthropic's sandbox, not on
  the mini PC. They're fine for "write this while I'm away", but they can't serve the app to your
  phone or see the real data. Use them only as an occasional extra.

## One-time setup on the mini PC

### 1. Network and remote access
- [ ] Install **Tailscale** and sign in to the same tailnet as the laptop, desktop and iPhone.
      Note the machine name (MagicDNS): `<minipc>` / `<minipc>.<tailnet>.ts.net`.
- [ ] **Remote Desktop** (Settings → System → Remote Desktop → On). Needs Windows 11 **Pro**; on Home,
      use Chrome Remote Desktop or similar. Connect over the Tailscale name. You'll use this for
      starting sessions and for anything that needs the mini PC's screen.
- [ ] **OpenSSH Server** (Settings → System → Optional features → Add → "OpenSSH Server"), then in
      Services set **OpenSSH SSH Server** to *Automatic* and start it. VS Code Remote-SSH uses it.
- [ ] Power settings: never sleep; restart after a power failure (BIOS) if available.
- [ ] Windows sign-in: the desktop app only runs while you're signed in. Either sign in once
      and leave the session locked (not signed out), or turn on automatic sign-in.

### 2. Tools
- [ ] Git, Node LTS, VS Code.
- [ ] Claude desktop app → sign in → **Settings → Claude Code → Enable remote control by default**.
- [ ] Add the Claude desktop app to startup apps so it comes back after a reboot.

### 3. The code
- [ ] Clone the repo to **`C:\Dev\sideshow`**. Using the same path as the other PCs keeps Claude's
      project folder name (`C--Dev-sideshow`) the same.
- [ ] `npm install`, then `npm test` and `npm run typecheck` to confirm it works.
- [ ] Copy Claude's memory once from the current PC:
      `%USERPROFILE%\.claude\projects\C--Dev-sideshow\memory\` → the same path on the mini PC.
      Old conversations don't need to come along. CLAUDE.md, DESIGN.md and memory carry the
      context, and a fresh session per task works well.
- [ ] Vite only answers hostnames it knows. To load the dev server by Tailscale name, add
      `allowedHosts: [".ts.net", "<minipc>"]` under `server` in `packages/web/vite.config.ts`
      (or use the Tailscale IP, which always works).
- [ ] Windows Firewall: allow Node on **private** networks when prompted. If the Tailscale adapter
      is classed as public, allow ports 5173 and 8787 for it.

### 4. Laptop and desktop
- [ ] Tailscale signed in.
- [ ] VS Code → install **Remote - SSH** → *Connect to Host* → `evan@<minipc>`. If the mini PC uses
      a Microsoft account, the SSH user may be your email or the local folder name; check with
      `whoami` on the mini PC. Set up an SSH key to skip the password prompts. Open
      `C:\Dev\sideshow`.
  - The Claude Code VS Code extension is optional. Installed in a Remote-SSH window, it runs *on
    the mini PC* and uses the same conversations as the desktop app there, which is fine. For
    chatting, the claude.ai/code tab is simpler.
- [ ] Bookmark claude.ai/code. Remote Control sessions show a computer icon with a green dot
      when they're online.
- [ ] Retire the local checkouts on these PCs (or leave them alone) so edits don't split between
      machines.

### 5. iPhone
- [ ] Tailscale app on and connected.
- [ ] Claude app → **Code** tab to see and continue sessions.
- [ ] Safari → `http://<minipc>:5173` to test the dev build.

## Keep dev and the real app separate

The mini PC will also run the always-on sideshow you actually log work in (see DESIGN.md,
architecture section). Keep the two apart so a half-finished change can't break the real log:

| | Dev | Real app |
|---|---|---|
| Folder | `C:\Dev\sideshow` | `C:\Apps\sideshow` (a separate clone that only pulls `main`) |
| Ports | 5173 web / 8787 API (`npm run dev`) | 8081, public via Cloudflare Tunnel ([home-hosting.md](home-hosting.md)) |
| DB | `data/sideshow.db` in the dev folder, or a scratch `SIDESHOW_DB` | `C:\Apps\sideshow\data\sideshow.db` + nightly backup |

Hosting the real app (tunnel, login, auto-start) is covered in [home-hosting.md](home-hosting.md).

## Everyday flow

1. Wherever you are, open claude.ai/code (or the Claude app) and pick the sideshow session, or
   RDP in and start a new one.
2. Ask for changes. Claude edits files and runs tests on the mini PC.
3. Check the result at `http://<minipc>:5173` from whatever device you're holding.
4. Read diffs in VS Code (Remote-SSH) or ask Claude to show them.
5. Ask Claude to commit/push when it's ready. GitHub is the backup of the code.
