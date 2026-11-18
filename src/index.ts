import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import express, { type Express } from "express";
import { createPublicClient, createWalletClient, http, publicActions, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig, type AppConfig } from "./config.js";
import { CHAINLINK_FEEDS } from "./feeds.js";
import { ChainlinkPriceProvider, MockPriceProvider, type PriceProvider } from "./prices.js";
import { generateReport } from "./research.js";
import { MockSwapExecutor, Treasury, type SwapExecutor } from "./treasury.js";
import { UniswapApiExecutor, DirectSwapExecutor } from "./swap.js";
import { buildPaywall, type PayToAddress } from "./x402.js";

export interface AppDeps {
  config: AppConfig;
  priceProvider: PriceProvider;
  treasury: Treasury;
  executor: SwapExecutor;
}

/** Demo executor: swaps at the live quote price, no chain involved. */
class MockExecutorWithPrices implements SwapExecutor {
  constructor(private priceProvider: PriceProvider) {}

  async swap(args: { from: "USDC"; to: string; amountUsdc: number }) {
    const quote = await this.priceProvider.getPrice(args.to);
    return new MockSwapExecutor(quote.priceUsd).swap(args);
  }
}

function loadDeployments(): Record<string, Address> {
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", "deployments", "base-sepolia.json");
  if (!existsSync(path)) return {};
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, { address: string }>;
  return Object.fromEntries(Object.entries(raw).map(([symbol, v]) => [symbol, v.address as Address]));
}

/** Builds the sweep executor from config. Direct mode needs only a test wallet; uniswap mode also needs an API key. */
export function buildExecutor(config: AppConfig, priceProvider: PriceProvider): SwapExecutor {
  if (config.swapExecutor === "mock") return new MockExecutorWithPrices(priceProvider);
  if (!config.testPrivateKey) {
    throw new Error("TEST_PRIVATE_KEY is required when SWAP_EXECUTOR=uniswap or direct");
  }
  // MetaMask shows the key without the 0x prefix — accept both forms.
  const rawKey = config.testPrivateKey.trim();
  const key = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`;
  const account = privateKeyToAccount(key);
  const transport = http(config.rpcUrl);
  const publicClient = createPublicClient({ chain: baseSepolia, transport }) as never;
  // The executors wait for receipts on the wallet client — a bare viem
  // wallet client has no waitForTransactionReceipt (that is a public
  // action), so extend it. Without this, the first real sweep crashes
  // with "waitForTransactionReceipt is not a function" (hit 19 Nov 2026).
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport }).extend(
    publicActions,
  ) as never;
  if (config.swapExecutor === "direct") {
    return new DirectSwapExecutor({
      usdc: config.usdcAddress as Address,
      tokens: loadDeployments(),
      swapper: account.address,
      publicClient,
      walletClient,
    });
  }
  if (!config.uniswapApiKey) {
    throw new Error("UNISWAP_API_KEY is required when SWAP_EXECUTOR=uniswap");
  }
  return new UniswapApiExecutor({
    apiKey: config.uniswapApiKey,
    usdc: config.usdcAddress as Address,
    tokens: loadDeployments(),
    swapper: account.address,
    publicClient,
    walletClient,
  });
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Paid endpoint: x402 paywall runs first (402 without X-PAYMENT).
  // After a paid report, profits above the reserve are swept into the
  // treasury token through the configured executor.
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
          await deps.treasury.executeSweep(plan, deps.executor);
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
  const priceProvider =
    config.priceSource === "chainlink"
      ? new ChainlinkPriceProvider("https://mainnet.base.org", CHAINLINK_FEEDS)
      : new MockPriceProvider();
  const executor = buildExecutor(config, priceProvider);
  const app = createApp({ config, priceProvider, treasury: new Treasury(), executor });
  app.listen(config.port, () => {
    console.log(`research-to-treasury-agent listening on :${config.port} (${config.network})`);
  });
}
