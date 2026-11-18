/**
 * Seeds a Uniswap V3 pool for USDC / mock-B20 on Base Sepolia so the
 * Trading API can quote swaps against it.
 *
 * Usage:
 *   pnpm tsx scripts/seed-pool.ts AAPLc [--usdc 10] [--price 280.5] [--fee 3000]
 *
 * Env: TEST_PRIVATE_KEY (deployer, holds the mock tokens + USDC),
 * RPC_URL (default https://sepolia.base.org). Reads the token address from
 * deployments/base-sepolia.json and records the pool under `pools`.
 * Default price is the example price from MockPriceProvider (same fixed
 * example values, NOT live market data); pass --price to override.
 * Fee tiers: 500 (0.05%), 3000 (0.3%, default), 10000 (1%).
 */
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { SEPOLIA_ADDRESSES, SEPOLIA_V3 } from "../src/feeds.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEPLOYMENTS_PATH = join(ROOT, "deployments", "base-sepolia.json");
const RPC_URL = process.env.RPC_URL ?? "https://sepolia.base.org";
const USDC_DECIMALS = 6;
const TOKEN_DECIMALS = 18;

/** Fixed example prices, same as MockPriceProvider. NOT live market data. */
const EXAMPLE_PRICES: Record<string, number> = { AAPLc: 280.5, NVDAc: 195.25, TSLAc: 440.0 };

const FACTORY_ABI = [
  {
    name: "getPool",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
] as const;

const NPM_ABI = [
  {
    name: "createAndInitializePoolIfNecessary",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "sqrtPriceX96", type: "uint160" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
  {
    name: "mint",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "token0", type: "address" },
          { name: "token1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickLower", type: "int24" },
          { name: "tickUpper", type: "int24" },
          { name: "amount0Desired", type: "uint256" },
          { name: "amount1Desired", type: "uint256" },
          { name: "amount0Min", type: "uint256" },
          { name: "amount1Min", type: "uint256" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
        ],
      },
    ],
    outputs: [
      { name: "tokenId", type: "uint256" },
      { name: "liquidity", type: "uint128" },
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
  },
  {
    name: "tokenOfOwnerByIndex",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "index", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** Integer square root for bigint (Newton's method). */
export function isqrt(value: bigint): bigint {
  if (value < 0n) throw new Error("isqrt of negative");
  if (value < 2n) return value;
  let x = value;
  let y = (x + 1n) >> 1n;
  while (y < x) {
    x = y;
    y = (x + value / x) >> 1n;
  }
  return x;
}

/**
 * sqrtPriceX96 for "1 token1 = P token0", with token0 = 6 decimals (USDC)
 * and token1 = 18 decimals (mock B20). Exact bigint math, no floats.
 * ratio (token1/token0 raw) = 10^18 / (P * 10^6); sqrtPriceX96 = sqrt(ratio) * 2^96.
 */
export function sqrtPriceX96ForPrice(priceUsd: number): bigint {
  const priceScaled = BigInt(Math.round(priceUsd * 1e6)); // P * 10^6
  const numerator = 10n ** 18n;
  return isqrt((numerator * 2n ** 192n) / priceScaled);
}

function alignDown(tick: number, spacing: number): number {
  return Math.floor(tick / spacing) * spacing;
}
function alignUp(tick: number, spacing: number): number {
  return Math.ceil(tick / spacing) * spacing;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const symbol = args.find((a) => !a.startsWith("--")) ?? "AAPLc";
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const usdcAmount = Number(flag("--usdc") ?? "10");
  const fee = Number(flag("--fee") ?? "3000");
  const price = Number(flag("--price") ?? String(EXAMPLE_PRICES[symbol] ?? 100));
  if (!Number.isFinite(usdcAmount) || usdcAmount <= 0) throw new Error("--usdc must be > 0");
  if (!Number.isFinite(price) || price <= 0) throw new Error("--price must be > 0");

  const privateKey = process.env.TEST_PRIVATE_KEY;
  if (!privateKey) {
    console.error("TEST_PRIVATE_KEY is required (deployer holding the mock tokens + USDC).");
    process.exit(1);
  }
  const rawKey = privateKey.trim();
  const account = privateKeyToAccount(
    (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`,
  );
  if (!existsSync(DEPLOYMENTS_PATH)) {
    console.error("deployments/base-sepolia.json not found — run scripts/deploy-mock-b20.ts first.");
    process.exit(1);
  }
  const deployments = JSON.parse(readFileSync(DEPLOYMENTS_PATH, "utf8")) as Record<
    string,
    { address?: string }
  >;
  const tokenAddress = deployments[symbol]?.address as Address | undefined;
  if (!tokenAddress) {
    console.error(`No deployment for ${symbol} — run scripts/deploy-mock-b20.ts ${symbol} first.`);
    process.exit(1);
  }

  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(RPC_URL) });
  console.log(`Deployer: ${account.address} | ${symbol} @ ${tokenAddress} | price $${price} | fee ${fee}`);

  const usdc = SEPOLIA_ADDRESSES.faucetUsdc;
  const [token0, token1] =
    usdc.toLowerCase() < tokenAddress.toLowerCase()
      ? [usdc, tokenAddress]
      : [tokenAddress, usdc];
  const token0IsUsdc = token0 === usdc;

  // 1. Pool: create + initialize if it does not exist yet.
  let pool = (await publicClient.readContract({
    address: SEPOLIA_V3.factory,
    abi: FACTORY_ABI,
    functionName: "getPool",
    args: [token0, token1, fee],
  })) as Address;
  const sqrtPriceX96 = sqrtPriceX96ForPrice(price);
  if (pool === "0x0000000000000000000000000000000000000000") {
    const hash = await walletClient.writeContract({
      address: SEPOLIA_V3.positionManager,
      abi: NPM_ABI,
      functionName: "createAndInitializePoolIfNecessary",
      args: [token0, token1, fee, sqrtPriceX96],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    pool = (await publicClient.readContract({
      address: SEPOLIA_V3.factory,
      abi: FACTORY_ABI,
      functionName: "getPool",
      args: [token0, token1, fee],
    })) as Address;
    console.log(`Pool created at ${pool} (tx ${hash})`);
  } else {
    console.log(`Pool already exists at ${pool}`);
  }

  // 2. Tick range: ~±10% around the initial price, aligned to the fee spacing (60).
  const ratio = 1e18 / Math.round(price * 1e6);
  const tick = Math.floor(Math.log(ratio) / Math.log(1.0001));
  const halfWidth = Math.floor(Math.log(1.1) / Math.log(1.0001));
  const tickLower = alignDown(tick - halfWidth, 60);
  const tickUpper = alignUp(tick + halfWidth, 60);

  // 3. Amounts: usdcAmount USDC + the matching mock amount at the seed price.
  const usdcRaw = BigInt(Math.round(usdcAmount * 10 ** USDC_DECIMALS));
  const mockRaw = (usdcRaw * 10n ** 18n) / BigInt(Math.round(price * 1e6));
  const amount0Desired = token0IsUsdc ? usdcRaw : mockRaw;
  const amount1Desired = token0IsUsdc ? mockRaw : usdcRaw;

  // 4. Approve the position manager for both tokens, then mint.
  for (const [token, amount] of [
    [token0, amount0Desired],
    [token1, amount1Desired],
  ] as const) {
    const allowance = (await publicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [account.address, SEPOLIA_V3.positionManager],
    })) as bigint;
    if (allowance < amount) {
      const hash = await walletClient.writeContract({
        address: token,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [SEPOLIA_V3.positionManager, amount],
      });
      await publicClient.waitForTransactionReceipt({ hash });
    }
  }
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
  const mintHash = await walletClient.writeContract({
    address: SEPOLIA_V3.positionManager,
    abi: NPM_ABI,
    functionName: "mint",
    args: [
      {
        token0,
        token1,
        fee,
        tickLower,
        tickUpper,
        amount0Desired,
        amount1Desired,
        amount0Min: 0n,
        amount1Min: 0n,
        recipient: account.address,
        deadline,
      },
    ],
  });
  await publicClient.waitForTransactionReceipt({ hash: mintHash });
  const balance = (await publicClient.readContract({
    address: SEPOLIA_V3.positionManager,
    abi: NPM_ABI,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;
  const tokenId = (await publicClient.readContract({
    address: SEPOLIA_V3.positionManager,
    abi: NPM_ABI,
    functionName: "tokenOfOwnerByIndex",
    args: [account.address, balance - 1n],
  })) as bigint;
  console.log(`Liquidity minted: pool ${pool}, position NFT #${tokenId} (tx ${mintHash})`);

  const pools = (deployments as Record<string, unknown>).pools as Record<string, unknown> | undefined;
  const next = {
    ...(deployments as Record<string, unknown>),
    pools: {
      ...(pools ?? {}),
      [symbol]: {
        pool,
        fee,
        tokenId: tokenId.toString(),
        tickLower,
        tickUpper,
        priceUsd: price,
        txHash: mintHash,
        seededAt: new Date().toISOString(),
      },
    },
  };
  writeFileSync(DEPLOYMENTS_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Wrote ${DEPLOYMENTS_PATH}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
