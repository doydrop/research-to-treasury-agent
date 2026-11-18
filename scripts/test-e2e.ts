/**
 * End-to-end test: pay for a research report via x402 and watch the
 * treasury sweep the profit into a mock B20 — all on Base Sepolia.
 *
 * 1. In one terminal, start the server (reserve 0 so the $0.05 sale sweeps):
 *      SWAP_EXECUTOR=direct SWEEP_RESERVE_USDC=0 pnpm dev
 * 2. In another terminal, run this script (same .env, same machine):
 *      pnpm tsx scripts/test-e2e.ts [AAPLc]
 *
 * The payer is the test wallet in .env (TEST_PRIVATE_KEY) — on testnet it
 * pays its own agent wallet, so the USDC only moves when the sweep swaps
 * it into the mock token. Nothing here touches mainnet.
 *
 * NOTE: x402 1.x has no wrapFetchWithPayment helper (that was 0.x), so the
 * 402 flow is done by hand with x402/client: select the requirement, sign
 * the payment header with the viem wallet, retry with X-PAYMENT.
 */
import "dotenv/config";
import { fileURLToPath } from "node:url";
import { createWalletClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import {
  createPaymentHeader,
  selectPaymentRequirements,
  type PaymentRequirements,
} from "x402/client";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const RPC_URL = process.env.RPC_URL ?? "https://sepolia.base.org";

async function main(): Promise<void> {
  const symbol = process.argv[2] ?? "AAPLc";
  const privateKey = process.env.TEST_PRIVATE_KEY;
  if (!privateKey) {
    console.error("TEST_PRIVATE_KEY is required (the payer + agent test wallet).");
    process.exit(1);
  }
  const rawKey = privateKey.trim();
  const account = privateKeyToAccount(
    (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`,
  );
  const wallet = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const health = await fetch(`${BASE_URL}/health`);
  if (!health.ok) throw new Error(`Server not up at ${BASE_URL} (GET /health -> ${health.status})`);
  console.log("Server up. Requesting a report (expecting 402)…");

  const body = JSON.stringify({ symbol });
  const first = await fetch(`${BASE_URL}/research`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (first.status !== 402) {
    throw new Error(`Expected 402 from POST /research, got ${first.status}: ${(await first.text()).slice(0, 200)}`);
  }
  const challenge = (await first.json()) as {
    x402Version: number;
    accepts: PaymentRequirements[];
  };
  const requirement = selectPaymentRequirements(challenge.accepts, "base-sepolia");
  console.log(`Paying ${requirement.maxAmountRequired} ${requirement.asset} on ${requirement.network}…`);

  const paymentHeader = await createPaymentHeader(
    wallet as never,
    challenge.x402Version,
    requirement,
  );
  const res = await fetch(`${BASE_URL}/research`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-PAYMENT": paymentHeader },
    body,
  });
  if (!res.ok) throw new Error(`POST /research -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const report = (await res.json()) as Record<string, unknown>;
  console.log("Report:", JSON.stringify(report, null, 2));

  const treasuryRes = await fetch(`${BASE_URL}/treasury`);
  const treasury = (await treasuryRes.json()) as Record<string, unknown>;
  console.log("Treasury:", JSON.stringify(treasury, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
