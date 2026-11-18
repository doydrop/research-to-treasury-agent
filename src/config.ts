export interface AppConfig {
  port: number;
  network: "base-sepolia" | "base";
  rpcUrl: string;
  payToAddress: string;
  pricePerReportUsd: string;
  treasuryToken: string;
  sweepReserveUsdc: number;
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
  };
}
