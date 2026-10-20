import { useEffect, useState } from "react";
import { api } from "../sync";
import { showToast } from "../toast";
import { Spinner } from "./Spinner";

// Settings › Connections: the ConnectWise settings, kept in the server's .env (not synced to
// devices, not in the database or its backups). One connection for the whole server; a workspace
// uses it when its profile does. The private key is never shown: leave it empty to keep the saved
// one (only possible while the site, company and public key stay the same).

interface Shown {
  site: string;
  companyId: string;
  clientId: string;
  publicKey: string;
  member: string;
  privateKeySet: boolean;
  on: boolean;
}
type Form = Omit<Shown, "privateKeySet" | "on"> & { privateKey: string };

const FIELDS: { key: keyof Form; label: string; help: string; placeholder?: string }[] = [
  { key: "site", label: "Site", help: "The API host for your region", placeholder: "api-na.myconnectwise.net" },
  { key: "companyId", label: "Company", help: "The company id you sign in to ConnectWise with" },
  { key: "publicKey", label: "Public key", help: "From the API member's API Keys tab" },
  { key: "privateKey", label: "Private key", help: "From the same place. Never shown again once saved" },
  { key: "clientId", label: "Client id", help: "The GUID registered at developer.connectwise.com" },
  { key: "member", label: "Member", help: "Whose time pushed entries are (your sign-in name). Empty: pushing is off", placeholder: "ecartwright" },
];

/** POST JSON; the server answers with JSON either way. */
async function post(path: string, body: object): Promise<{ ok: boolean; body: any }> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

export function ConnectionSettings() {
  const [saved, setSaved] = useState<Shown | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const take = (cw: Shown) => {
    setSaved(cw);
    setForm({ site: cw.site, companyId: cw.companyId, clientId: cw.clientId, publicKey: cw.publicKey, member: cw.member, privateKey: "" });
  };
  useEffect(() => {
    api("/api/connections")
      .then((r) => r.json())
      .then((b: { cw: Shown }) => take(b.cw))
      .catch(() => setError("Couldn't load the connection settings: check the connection."));
  }, []);

  if (error) return <p className="warn small setting-help">{error}</p>;
  if (!saved || !form) return <p className="muted small busy-line"><Spinner /> Loading…</p>;

  // The saved private key goes with the saved site, company and public key only.
  const keyKept = form.site === saved.site && form.companyId === saved.companyId && form.publicKey === saved.publicKey;
  const changed = (Object.keys(form) as (keyof Form)[]).some((k) => (k === "privateKey" ? !!form.privateKey : form[k] !== saved[k]));
  const set = (k: keyof Form, v: string) => {
    setForm({ ...form, [k]: v });
    setResult(null);
  };

  const test = async () => {
    setBusy("test");
    try {
      const { body } = await post("/api/connections/cw/test", form);
      setResult(
        body.ok
          ? { ok: true, text: `Signed in${body.version ? ` (ConnectWise ${body.version})` : ""}${body.memberName ? `; pushes as ${body.memberName}` : form.member ? "" : "; no member, so pushing is off"}.` }
          : { ok: false, text: body.error ?? "That didn't work" },
      );
    } catch {
      setResult({ ok: false, text: "Couldn't reach the server" });
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    try {
      const { ok, body } = await post("/api/connections/cw", form);
      if (!ok) {
        setResult({ ok: false, text: `Not saved: ${body.error ?? "that didn't work"}` });
        return;
      }
      take(body.cw);
      setResult(null);
      showToast(body.cw.on ? "ConnectWise settings saved and in use" : "ConnectWise is off");
    } catch {
      setResult({ ok: false, text: "Couldn't reach the server. Nothing was saved." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <p className="muted small setting-help">
        ConnectWise, for the whole server; each workspace uses it if its profile does. Saved in the server's <code>.env</code>{" "}
        (the previous one is kept as <code>.env.bak</code>), not on your devices or in backups. Saving tests the settings first.
      </p>
      <p className={`small conn-status ${saved.on ? "on" : ""}`}>{saved.on ? `● Connected to ${saved.site}` : "○ Off"}</p>
      <form
        className="conn-form"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {FIELDS.map((f) => (
          <label key={f.key} className="conn-field">
            <span className="copy-label">{f.label}</span>
            <input
              className="search"
              type={f.key === "privateKey" ? "password" : "text"}
              autoComplete={f.key === "privateKey" ? "new-password" : "off"}
              spellCheck={false}
              autoCapitalize="off"
              value={form[f.key]}
              placeholder={
                f.key === "privateKey"
                  ? saved.privateKeySet
                    ? keyKept
                      ? "Saved: leave empty to keep it"
                      : "Type it again (the site, company or public key changed)"
                    : "Not set"
                  : f.placeholder
              }
              onChange={(e) => set(f.key, e.target.value)}
            />
            <span className="muted small">{f.help}</span>
          </label>
        ))}
        {result && <p className={`small ${result.ok ? "conn-ok" : "warn"}`} role="status">{result.text}</p>}
        <div className="row-actions">
          <button type="button" className="btn" disabled={!!busy || !form.site} onClick={() => void test()}>
            {busy === "test" ? "Testing…" : "Test connection"}
          </button>
          <span className="spacer" />
          {changed && (
            <button type="button" className="btn subtle" disabled={!!busy} onClick={() => { take(saved); setResult(null); }}>
              Undo changes
            </button>
          )}
          <button type="submit" className="btn primary" disabled={!!busy || !changed}>
            {busy === "save" ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </>
  );
}
