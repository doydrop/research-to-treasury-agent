import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/index";
import { MockPriceProvider } from "../src/prices";
import { MockSwapExecutor, Treasury } from "../src/treasury";

describe("server", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createApp({
      config: {
        port: 0,
        network: "base-sepolia",
        rpcUrl: "https://sepolia.base.org",
        payToAddress: "0x1111111111111111111111111111111111111111",
        pricePerReportUsd: "0.05",
        treasuryToken: "AAPLc",
        sweepReserveUsdc: 0.5,
        priceSource: "mock",
        swapExecutor: "mock",
        uniswapApiKey: "",
        testPrivateKey: "",
        usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      },
      priceProvider: new MockPriceProvider(),
      treasury: new Treasury(),
      executor: new MockSwapExecutor(280.5),
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("GET /health returns ok", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("POST /research without payment returns 402", async () => {
    const res = await fetch(`${baseUrl}/research`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbol: "AAPLc" }),
    });
    expect(res.status).toBe(402);
  });

  it("GET /treasury returns the ledger snapshot", async () => {
    const res = await fetch(`${baseUrl}/treasury`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ usdcBalance: 0, sales: 0, holdings: [] });
  });
});
