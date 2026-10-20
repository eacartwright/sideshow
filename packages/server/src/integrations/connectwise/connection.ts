import { envSafe } from "../../envfile";
import { ConnectWiseClient, CwError } from "./client";

// The ConnectWise connection as Settings › Connections edits it: the CW_* lines of the server's
// .env. One for the whole server; a workspace uses it when its profile has a connectwise section.
//
// The private key never goes back to the browser. Leaving it empty keeps the one saved, but only
// while the site, company and public key stay the same: otherwise a page that got the browser to
// send a changed site could have the saved key sent to a server of its choosing.

export interface CwSettings {
  site: string;
  companyId: string;
  clientId: string;
  publicKey: string;
  privateKey: string;
  member: string;
}

export const ENV_KEYS: Record<keyof CwSettings, string> = {
  site: "CW_SITE",
  companyId: "CW_COMPANY_ID",
  clientId: "CW_CLIENT_ID",
  publicKey: "CW_PUBLIC_KEY",
  privateKey: "CW_PRIVATE_KEY",
  member: "CW_MEMBER",
};

export function settingsFromEnv(env: NodeJS.ProcessEnv): CwSettings {
  const get = (k: keyof CwSettings) => (env[ENV_KEYS[k]] ?? "").trim();
  return { site: get("site"), companyId: get("companyId"), clientId: get("clientId"), publicKey: get("publicKey"), privateKey: get("privateKey"), member: get("member") };
}

/** What the browser is shown: everything but the private key, which is only said to be set. */
export function shown(s: CwSettings) {
  const { privateKey, ...rest } = s;
  return { ...rest, privateKeySet: !!privateKey };
}

/**
 * The settings to use from what the browser sent, or why not. An empty private key keeps the
 * saved one only if the site, company and public key are unchanged.
 */
export function resolve(sent: unknown, saved: CwSettings): { settings: CwSettings } | { error: string } {
  const b = (sent ?? {}) as Record<string, unknown>;
  const out = {} as CwSettings;
  for (const k of Object.keys(ENV_KEYS) as (keyof CwSettings)[]) {
    const v = typeof b[k] === "string" ? (b[k] as string).trim() : "";
    if (!envSafe(v)) return { error: `That ${k === "privateKey" ? "private key" : k} has characters that can't be saved` };
    out[k] = v;
  }
  out.site = out.site.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (!out.privateKey) {
    const same = out.site === saved.site && out.companyId === saved.companyId && out.publicKey === saved.publicKey;
    if (!same && out.site) return { error: "Changing the site, company or public key needs the private key typed again" };
    // (No site turns ConnectWise off; the key stays in .env, unused.)
    out.privateKey = saved.privateKey;
  }
  if (out.site) {
    const missing = (["companyId", "clientId", "publicKey", "privateKey"] as const).filter((k) => !out[k]);
    if (missing.length) return { error: "Site, company, client id, public key and private key are all needed" };
    if (!/^[a-z0-9.-]+(:\d+)?$/i.test(out.site)) return { error: "The site is a host name, e.g. api-na.myconnectwise.net" };
  }
  return { settings: out };
}

/**
 * Sign in to CW with these settings: whether they work, and whose name the member is. `baseUrl`
 * is for tests against a stand-in (CW_BASE_URL).
 */
export async function testConnection(s: CwSettings, baseUrl?: string): Promise<{ ok: true; version?: string; memberName?: string } | { ok: false; error: string }> {
  try {
    const cw = new ConnectWiseClient({ site: s.site, companyId: s.companyId, publicKey: s.publicKey, privateKey: s.privateKey, clientId: s.clientId, baseUrl });
    cw.retries = 0;
    const info = await cw.systemInfo();
    if (!s.member) return { ok: true, version: info.version };
    const [m] = await cw.findMembers(`identifier="${s.member.replace(/"/g, "")}"`);
    if (!m) return { ok: false, error: `Signed in, but there's no member "${s.member}"` };
    return { ok: true, version: info.version, memberName: [m.firstName, m.lastName].filter(Boolean).join(" ") || m.identifier };
  } catch (err) {
    if (err instanceof CwError) {
      if (err.status === 401) return { ok: false, error: "ConnectWise turned those keys down (401): check the company, public and private key" };
      if (err.status === 403) return { ok: false, error: "Signed in, but the API member isn't allowed that (403)" };
      return { ok: false, error: `ConnectWise answered ${err.status}` };
    }
    return { ok: false, error: `Couldn't reach ${s.site}: check the site` };
  }
}
