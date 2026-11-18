import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import { loadConfig, type AppConfig } from "./config.js";
import { MockPriceProvider, type PriceProvider } from "./prices.js";
import { generateReport } from "./research.js";
import { MockSwapExecutor, Treasury } from "./treasury.js";
import { buildPaywall, type PayToAddress } from "./x402.js";

export interface AppDeps {
  config: AppConfig;
  priceProvider: PriceProvider;
  treasury: Treasury;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Paid endpoint: x402 paywall runs first (402 without X-PAYMENT).
  // After a paid report, profits above the reserve are swept into the
  // treasury token. The sweep currently uses MockSwapExecutor (demo);
  // the on-chain 0x/Aerodrome executor is the next milestone.
  app.post(
    "/research",
    buildPaywall(deps.config.payToAddress as PayToAddress, deps.config.pricePerReportUsd),
    async (req, res) => {
      try {
        const symbol = String(req.body?.symbol ?? "");
        const report = await generateReport(symbol, deps.priceProvider);
        deps.treasury.recordSale(Number(deps.config.pricePerReportUsd));
        const plan = deps.treasury.planSweep(deps.config.treasuryToken, deps.config.sweepReserveUsdc);
        if (plan) {
          const quote = await deps.priceProvider.getPrice(plan.targetSymbol);
          await deps.treasury.executeSweep(plan, new MockSwapExecutor(quote.priceUsd));
        }
        res.json(report);
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    },
  );

  app.get("/treasury", (_req, res) => {
    res.json(deps.treasury.snapshot());
  });

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  if (!config.payToAddress) {
    console.error("PAY_TO_ADDRESS is required (see .env.example)");
    process.exit(1);
  }
  const app = createApp({ config, priceProvider: new MockPriceProvider(), treasury: new Treasury() });
  app.listen(config.port, () => {
    console.log(`research-to-treasury-agent listening on :${config.port} (${config.network})`);
  });
}
