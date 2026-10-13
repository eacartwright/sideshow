import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ConnectWiseClient, CwError, retryWait } from "./client";

let server: Server | null = null;
afterEach(() => {
  server?.close();
  server = null;
});

/** A CW that answers 429 the first `busy` times, then 200. */
async function busyCw(busy: number) {
  let calls = 0;
  server = createServer((_req, res) => {
    calls++;
    if (calls <= busy) {
      res.writeHead(429, { "content-type": "application/json", "retry-after": "1" });
      return res.end(JSON.stringify({ code: "ConnectWiseApi", message: "Too many requests. Please try again in 1 seconds." }));
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: 106745, summary: "API test ticket" }));
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  const cw = new ConnectWiseClient({ site: "x", companyId: "x", publicKey: "x", privateKey: "x", clientId: "x", baseUrl: `http://127.0.0.1:${port}` });
  return { cw, calls: () => calls };
}

describe("CW rate limit", () => {
  it("waits as long as CW asks", () => {
    expect(retryWait("5", "")).toBe(5000);
    expect(retryWait(null, '{"message":"Too many requests. Please try again in 30 seconds."}')).toBe(30_000);
    expect(retryWait(null, "")).toBe(30_000);
    expect(retryWait("600", "")).toBe(60_000);
  });

  it("sends a request turned away with 429 again", async () => {
    const { cw, calls } = await busyCw(1);
    expect(await cw.getTicket(106745)).toMatchObject({ summary: "API test ticket" });
    expect(calls()).toBe(2);
  });

  it("gives up after its retries", async () => {
    const { cw, calls } = await busyCw(5);
    cw.retries = 1;
    await expect(cw.getTicket(106745)).rejects.toBeInstanceOf(CwError);
    expect(calls()).toBe(2);
  });
});
