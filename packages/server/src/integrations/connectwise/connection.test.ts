import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolve, settingsFromEnv, shown, testConnection, type CwSettings } from "./connection";

const saved: CwSettings = {
  site: "api-na.myconnectwise.net",
  companyId: "veritaz",
  clientId: "guid",
  publicKey: "pub",
  privateKey: "secret",
  member: "ecartwright",
};

describe("connection settings", () => {
  it("never shows the private key", () => {
    const s = shown(saved);
    expect(s).not.toHaveProperty("privateKey");
    expect(JSON.stringify(s)).not.toContain("secret");
    expect(s.privateKeySet).toBe(true);
  });

  it("keeps the saved private key while the site, company and public key stay", () => {
    const r = resolve({ ...saved, privateKey: "", member: "someone" }, saved);
    expect(r).toEqual({ settings: { ...saved, member: "someone" } });
  });

  it("won't send the saved key to a changed site, company or public key", () => {
    for (const change of [{ site: "evil.example" }, { companyId: "other" }, { publicKey: "other" }]) {
      expect(resolve({ ...saved, ...change, privateKey: "" }, saved)).toEqual({
        error: "Changing the site, company or public key needs the private key typed again",
      });
    }
    // Typed again: fine.
    expect(resolve({ ...saved, site: "api-eu.myconnectwise.net", privateKey: "new" }, saved)).toEqual({
      settings: { ...saved, site: "api-eu.myconnectwise.net", privateKey: "new" },
    });
  });

  it("turns ConnectWise off with no site, keeping the key in .env", () => {
    expect(resolve({ ...saved, site: "", privateKey: "" }, saved)).toEqual({ settings: { ...saved, site: "" } });
  });

  it("tidies the site and refuses what .env can't hold", () => {
    expect(resolve({ ...saved, site: "https://api-na.myconnectwise.net/v4_6_release", privateKey: "" }, saved)).toEqual({ settings: saved });
    expect("error" in resolve({ ...saved, member: "x\nPORT=1" }, saved)).toBe(true);
    expect("error" in resolve({ ...saved, site: "a b", privateKey: "k" }, saved)).toBe(true);
    expect("error" in resolve({ ...saved, clientId: "", privateKey: "k" }, saved)).toBe(true);
  });

  it("reads the CW_* lines", () => {
    expect(settingsFromEnv({ CW_SITE: " s ", CW_MEMBER: "m" })).toEqual({ site: "s", companyId: "", clientId: "", publicKey: "", privateKey: "", member: "m" });
  });
});

describe("testConnection", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    // A stand-in for CW: the right keys are veritaz+pub:secret; one member, ecartwright.
    const good = `Basic ${Buffer.from("veritaz+pub:secret").toString("base64")}`;
    server = createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.headers.authorization !== good) {
        res.statusCode = 401;
        return res.end("{}");
      }
      if (req.url!.startsWith("/system/info")) return res.end(JSON.stringify({ version: "v2025.1" }));
      if (req.url!.startsWith("/system/members")) {
        const ok = decodeURIComponent(req.url!).includes('identifier="ecartwright"');
        return res.end(JSON.stringify(ok ? [{ id: 192, identifier: "ecartwright", firstName: "Evan", lastName: "Cartwright" }] : []));
      }
      res.statusCode = 404;
      res.end("{}");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("signs in and names the member", async () => {
    expect(await testConnection(saved, base)).toEqual({ ok: true, version: "v2025.1", memberName: "Evan Cartwright" });
    expect(await testConnection({ ...saved, member: "" }, base)).toEqual({ ok: true, version: "v2025.1" });
  });

  it("says what's wrong", async () => {
    expect(await testConnection({ ...saved, privateKey: "wrong" }, base)).toMatchObject({ ok: false, error: expect.stringContaining("401") });
    expect(await testConnection({ ...saved, member: "nobody" }, base)).toEqual({ ok: false, error: `Signed in, but there's no member "nobody"` });
    expect(await testConnection(saved, "http://127.0.0.1:9")).toMatchObject({ ok: false, error: expect.stringContaining("Couldn't reach") });
  });
});
