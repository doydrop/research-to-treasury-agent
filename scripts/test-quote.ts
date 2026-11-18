/**
 * Quote-only test of the swap executor on Base Sepolia.
 * Fetches a real quote for USDC -> mock-B20 against the seeded pool.
 * No signing, no funds move. Needs a seeded pool or the quote fails.
 *
 * Usage:
 *   pnpm tsx scripts/test-quote.ts [AAPLc] [--amount 1]
 *
 * Executor: SWAP_EXECUTOR=direct (default — QuoterV2 on-chain, no API key)
 * or SWAP_EXECUTOR=uniswap (Trading API, needs UNISWAP_API_KEY).
 * Needs PAY_TO_ADDRESS or TEST_PRIVATE_KEY (to derive the swapper address).
 */
import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { UniswapApiExecutor, DirectSwapExecutor } from "../src/swap.js";
import { SEPOLIA_ADDRESSES } from "../src/feeds.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEPLOYMENTS_PATH = join(ROOT, "deployments", "base-sepolia.json");
const RPC_URL = process.env.RPC_URL ?? "https://sepolia.base.org";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const symbol = args.find((a) => !a.startsWith("--")) ?? "AAPLc";
  const amountFlag = args.indexOf("--amount");
  const amountUsdc = Number(amountFlag >= 0 ? args[amountFlag + 1] : "1");
  const mode = process.env.SWAP_EXECUTOR === "uniswap" ? "uniswap" : "direct";

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

  const executor =
    mode === "uniswap"
      ? new UniswapApiExecutor({
          apiKey: process.env.UNISWAP_API_KEY ?? "",
          usdc: SEPOLIA_ADDRESSES.faucetUsdc,
          tokens,
          swapper,
        })
      : new DirectSwapExecutor({
          usdc: SEPOLIA_ADDRESSES.faucetUsdc,
          tokens,
          swapper,
          publicClient: createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) }) as never,
        });
  const quote = await executor.quote({ to: symbol, amountUsdc });
  const decimals = 18;
  console.log(
    JSON.stringify(
      {
        executor: mode,
        symbol,
        amountUsdc,
        amountOut: (Number(quote.amountOut) / 10 ** decimals).toString(),
        router: quote.swapTransaction?.to ?? "(direct executor: router called on swap, not in quote)",
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
