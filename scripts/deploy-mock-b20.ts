/**
 * Deploys MockB20 tokens on Base Sepolia (one per symbol) and records their
 * addresses in deployments/base-sepolia.json for the swap executor.
 *
 * Usage:
 *   pnpm tsx scripts/deploy-mock-b20.ts --dry-run        # compile only, no wallet needed
 *   pnpm tsx scripts/deploy-mock-b20.ts AAPLc NVDAc      # deploy (needs TEST_PRIVATE_KEY + Sepolia ETH)
 *
 * Env: RPC_URL (default https://sepolia.base.org), TEST_PRIVATE_KEY (0x...,
 * never logged, never committed). The deployer receives the initial supply
 * (1,000,000 tokens each) so it can seed a Uniswap pool for the pair.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import "dotenv/config";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT_PATH = join(ROOT, "contracts", "MockB20.sol");
const DEPLOYMENTS_PATH = join(ROOT, "deployments", "base-sepolia.json");
const RPC_URL = process.env.RPC_URL ?? "https://sepolia.base.org";
const INITIAL_SUPPLY = parseEther("1000000");

export function compileMockB20(): { abi: unknown; bytecode: string } {
  const source = readFileSync(CONTRACT_PATH, "utf8");
  const input = {
    language: "Solidity",
    sources: { "MockB20.sol": { content: source } },
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
  const contract = output.contracts["MockB20.sol"]["MockB20"];
  const bytecode = `0x${contract.evm.bytecode.object}` as const;
  if (bytecode.length < 10) throw new Error("solc produced empty bytecode");
  return { abi: contract.abi, bytecode };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const symbols = args.filter((a) => !a.startsWith("--"));
  const targets = symbols.length > 0 ? symbols : ["AAPLc", "NVDAc", "TSLAc"];

  const { abi, bytecode } = compileMockB20();
  console.log(`MockB20 compiled: bytecode ${bytecode.length} chars, ABI entries ${(abi as unknown[]).length}`);
  if (dryRun) {
    console.log("dry-run: compilation OK, nothing deployed.");
    return;
  }

  const privateKey = process.env.TEST_PRIVATE_KEY;
  if (!privateKey) {
    console.error("TEST_PRIVATE_KEY is required to deploy (a Sepolia test wallet, funded with faucet ETH).");
    process.exit(1);
  }
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(RPC_URL) });
  console.log(`Deployer: ${account.address} (Base Sepolia)`);

  const deployments: Record<string, { address: string; txHash: string; deployedAt: string }> = existsSync(
    DEPLOYMENTS_PATH,
  )
    ? JSON.parse(readFileSync(DEPLOYMENTS_PATH, "utf8"))
    : {};

  for (const symbol of targets) {
    const hash = await walletClient.deployContract({
      abi: abi as never,
      bytecode: bytecode as `0x${string}`,
      args: [`Mock ${symbol}`, symbol, INITIAL_SUPPLY, account.address],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error(`Deploy failed for ${symbol}: ${hash}`);
    deployments[symbol] = {
      address: receipt.contractAddress,
      txHash: hash,
      deployedAt: new Date().toISOString(),
    };
    console.log(`${symbol} deployed at ${receipt.contractAddress} (tx ${hash})`);
  }

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
