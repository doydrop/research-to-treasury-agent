import type { Address } from "viem";

/**
 * Verified Chainlink total-return feeds for Coinbase B20 tokenized stocks,
 * read live from the official Base docs
 * (docs.base.org/build-on-base/integrate-defi/list-tokenized-stocks, 18 Nov 2026).
 * All feeds: 8 decimals, 24/5, total-return values (underlying price x multiplier).
 * Keys are our app symbols (AAPLc etc.); values are the feed proxy addresses.
 */
export const CHAINLINK_FEEDS: Record<string, Address> = {
  AAPLc: "0x787f13dEa48Db0897CbCDD985de77809D837F988",
  AMZNc: "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295",
  GOOGLc: "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2",
  METAc: "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D",
  MSFTc: "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c",
  MSTRc: "0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a",
  NVDAc: "0x04689a41629776563E6822F76f2e57D148d28513",
  SNDKc: "0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA",
  SPCXc: "0x6A634B235903C4ad6376892180d6fF8612e3Fa68",
  TSLAc: "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4",
};

/** Base Sepolia (chain id 84532) addresses, each verified on-chain via eth_getCode, 18 Nov 2026. */
export const SEPOLIA_ADDRESSES = {
  /** Circle faucet USDC on Base Sepolia, 6 decimals. Get test USDC from the Circle faucet. */
  faucetUsdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address,
  /** Permit2 (canonical). The Universal Router pulls tokens through it. */
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address,
  /** Universal Router (Uniswap docs table for Base Sepolia). The Trading API returns the router in swapTransaction.to — use that at runtime, this is a reference. */
  universalRouter: "0x8b844f885672f333bc0042cb669255f93a4c1e6b" as Address,
  /** WETH on Base Sepolia. */
  weth: "0x4200000000000000000000000000000000000006" as Address,
} as const;

/** Aerodrome has NO Base Sepolia deployment (confirmed via aerodrome-finance/contracts: mainnet only). Do not use Aerodrome addresses on testnet. */
export const AERODROME_SEPOLIA_AVAILABLE = false;

/**
 * Uniswap V3 on Base Sepolia, from the official Uniswap docs
 * (developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments)
 * and verified on-chain via eth_getCode, 19 Nov 2026.
 * NOTE: Base uses different V3 addresses than other chains — do not use the
 * canonical 0x1F98431c... factory here (it has no code on Sepolia).
 */
export const SEPOLIA_V3 = {
  factory: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24" as Address,
  positionManager: "0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2" as Address,
} as const;
