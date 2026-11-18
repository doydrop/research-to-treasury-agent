/**
 * Quote-only test of the Uniswap executor on Base Sepolia.
 * Fetches a real Trading API quote for USDC -> mock-B20. No signing,
 * no funds move. Needs a seeded pool or the API answers "No quotes available".
 *
 * Usage:
 *   pnpm tsx scripts/test-quote.ts [AAPLc] [--amount 1]
 *
 * Env: UNISWAP_API_KEY (from the Uniswap docs portal), plus either
 * PAY_TO_ADDRESS or TEST_PRIVATE_KEY (to derive the swapper address).
 */
import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { UniswapApiExecutor } from "../src/swap.js";
import { SEPOLIA_ADDRESSES } from "../src/feeds.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEPLOYMENTS_PATH = join(ROOT, "deployments", "base-sepolia.json");

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const symbol = args.find((a) => !a.startsWith("--")) ?? "AAPLc";
  const amountFlag = args.indexOf("--amount");
  const amountUsdc = Number(amountFlag >= 0 ? args[amountFlag + 1] : "1");

  const apiKey = process.env.UNISWAP_API_KEY;
  if (!apiKey) {
    console.error("UNISWAP_API_KEY is required (free key from the Uniswap docs portal).");
    process.exit(1);
  }
  let swapper = process.env.PAY_TO_ADDRESS as Address | undefined;
  if (!swapper && process.env.TEST_PRIVATE_KEY) {
    const rawKey = process.env.TEST_PRIVATE_KEY.trim();
    swapper = privateKeyToAccount(
      (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`,
    ).address;
  }
  if (!swapper) {
    console.error("Set PAY_TO_ADDRESS or TEST_PRIVATE_KEY so the quote has a swapper address.");
    process.exit(1);
  }
  if (!existsSync(DEPLOYMENTS_PATH)) {
    console.error("deployments/base-sepolia.json not found — run scripts/deploy-mock-b20.ts first.");
    process.exit(1);
  }
  const deployments = JSON.parse(readFileSync(DEPLOYMENTS_PATH, "utf8")) as Record<
    string,
    { address?: string }
  >;
  const tokens: Record<string, Address> = {};
  for (const [key, value] of Object.entries(deployments)) {
    if (value?.address) tokens[key] = value.address as Address;
  }
  if (!tokens[symbol]) {
    console.error(`No deployment for ${symbol} — run scripts/deploy-mock-b20.ts ${symbol} first.`);
    process.exit(1);
  }

  const executor = new UniswapApiExecutor({
    apiKey,
    usdc: SEPOLIA_ADDRESSES.faucetUsdc,
    tokens,
    swapper,
  });
  const quote = await executor.quote({ to: symbol, amountUsdc });
  const decimals = 18;
  console.log(
    JSON.stringify(
      {
        symbol,
        amountUsdc,
        amountOut: (Number(quote.amountOut) / 10 ** decimals).toString(),
        router: quote.swapTransaction?.to ?? "(no swapTransaction in quote)",
        hasSwapTransaction: Boolean(quote.swapTransaction),
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
