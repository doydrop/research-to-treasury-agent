import { SEPOLIA_ADDRESSES } from "./feeds.js";

export interface AppConfig {
  port: number;
  network: "base-sepolia" | "base";
  rpcUrl: string;
  payToAddress: string;
  pricePerReportUsd: string;
  treasuryToken: string;
  sweepReserveUsdc: number;
  /** "mock" (fixed example prices) or "chainlink" (live Base mainnet feeds). */
  priceSource: "mock" | "chainlink";
  /** "mock" (demo swaps) or "uniswap" (real Sepolia swaps via the Trading API). */
  swapExecutor: "mock" | "uniswap";
  uniswapApiKey: string;
  /** Sepolia test-wallet private key. Never logged, never committed. */
  testPrivateKey: string;
  usdcAddress: string;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Reads config from env. PAY_TO_ADDRESS is required when the server starts. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const network = env.NETWORK === "base" ? "base" : "base-sepolia";
  const rpcUrl =
    env.RPC_URL ??
    (network === "base" ? "https://mainnet.base.org" : "https://sepolia.base.org");
  return {
    port: envInt("PORT", 3000),
    network,
    rpcUrl,
    payToAddress: env.PAY_TO_ADDRESS ?? "",
    pricePerReportUsd: env.PRICE_PER_REPORT_USDC ?? "0.05",
    treasuryToken: env.TREASURY_TOKEN ?? "AAPLc",
    sweepReserveUsdc: envFloat("SWEEP_RESERVE_USDC", 0.5),
    priceSource: env.PRICE_SOURCE === "chainlink" ? "chainlink" : "mock",
    swapExecutor: env.SWAP_EXECUTOR === "uniswap" ? "uniswap" : "mock",
    uniswapApiKey: env.UNISWAP_API_KEY ?? "",
    testPrivateKey: env.TEST_PRIVATE_KEY ?? "",
    usdcAddress: env.USDC_ADDRESS ?? SEPOLIA_ADDRESSES.faucetUsdc,
  };
}
