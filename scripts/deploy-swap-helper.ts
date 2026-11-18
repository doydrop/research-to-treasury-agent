/**
 * Deploys the SwapHelper contract on Base Sepolia and records its address in
 * deployments/base-sepolia.json (under the `helper` key) for the sweep executor.
 *
 * Usage:
 *   pnpm tsx scripts/deploy-swap-helper.ts --dry-run   # compile only, no wallet needed
 *   pnpm tsx scripts/deploy-swap-helper.ts             # deploy (needs TEST_PRIVATE_KEY + Sepolia ETH)
 *
 * Why this contract exists: the SwapRouter02 listed for Base Sepolia reverts
 * on every pool (verified 19 Nov 2026 on our seeded USDC/AAPLc pool and on a
 * liquid WETH/USDC pool, while QuoterV2 + the position manager work fine).
 * The helper calls the pool directly with a known pool address, so it never
 * depends on the router's pool-address computation.
 * After deploying, approve the helper for USDC once (the executor does this
 * automatically when allowance is short) and run the server with
 * SWAP_EXECUTOR=helper.
 *
 * Env: RPC_URL (default https://sepolia.base.org), TEST_PRIVATE_KEY (0x...,
 * never logged, never committed).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import "dotenv/config";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";
import { createPublicClient, createWalletClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT_PATH = join(ROOT, "contracts", "SwapHelper.sol");
const DEPLOYMENTS_PATH = join(ROOT, "deployments", "base-sepolia.json");
const RPC_URL = process.env.RPC_URL ?? "https://sepolia.base.org";

export function compileSwapHelper(): { abi: unknown; bytecode: string } {
  const source = readFileSync(CONTRACT_PATH, "utf8");
  const input = {
    language: "Solidity",
    sources: { "SwapHelper.sol": { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors ?? []).filter((e: { severity: string }) => e.severity === "error");
  if (errors.length > 0) {
    throw new Error(`solc errors: ${JSON.stringify(errors, null, 2)}`);
  }
  const contract = output.contracts["SwapHelper.sol"]["SwapHelper"];
  const bytecode = `0x${contract.evm.bytecode.object}` as const;
  if (bytecode.length < 10) throw new Error("solc produced empty bytecode");
  return { abi: contract.abi, bytecode };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  const { abi, bytecode } = compileSwapHelper();
  console.log(
    `SwapHelper compiled: bytecode ${bytecode.length} chars, ABI entries ${(abi as unknown[]).length}`,
  );
  if (dryRun) {
    console.log("dry-run: compilation OK, nothing deployed.");
    return;
  }

  const privateKey = process.env.TEST_PRIVATE_KEY;
  if (!privateKey) {
    console.error("TEST_PRIVATE_KEY is required to deploy (a Sepolia test wallet, funded with faucet ETH).");
    process.exit(1);
  }
  // MetaMask shows the key without the 0x prefix — accept both forms.
  const normalizedKey = privateKey.trim().startsWith("0x")
    ? (privateKey.trim() as `0x${string}`)
    : (`0x${privateKey.trim()}` as `0x${string}`);
  const account = privateKeyToAccount(normalizedKey);
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(RPC_URL) });
  console.log(`Deployer: ${account.address} (Base Sepolia)`);

  const deployments: Record<string, unknown> = existsSync(DEPLOYMENTS_PATH)
    ? JSON.parse(readFileSync(DEPLOYMENTS_PATH, "utf8"))
    : {};

  const hash = await walletClient.deployContract({
    abi: abi as never,
    bytecode: bytecode as `0x${string}`,
    args: [],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error(`Deploy failed: ${hash}`);
  deployments["helper"] = {
    address: receipt.contractAddress,
    txHash: hash,
    deployedAt: new Date().toISOString(),
  };
  console.log(`SwapHelper deployed at ${receipt.contractAddress} (tx ${hash})`);

  mkdirSync(dirname(DEPLOYMENTS_PATH), { recursive: true });
  writeFileSync(DEPLOYMENTS_PATH, `${JSON.stringify(deployments, null, 2)}\n`);
  console.log(`Wrote ${DEPLOYMENTS_PATH}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
