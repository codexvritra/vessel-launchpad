import { defineChain } from "viem";
import { CHAIN_ID, RPC_URL } from "./config";

/**
 * "Robinhood Chain" — the Signapad deployment target (Arbitrum-Orbit L2). Defined
 * from env so a local anvil node (31337), the testnet (46630), or mainnet (4663)
 * works without code changes. Testnet explorer is Blockscout-style.
 */
const explorer =
  CHAIN_ID === 4663
    ? "https://robinhoodchain.blockscout.com"
    : "https://explorer.testnet.chain.robinhood.com";

export const robinhoodChain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_ID === 4663 ? "Robinhood Chain" : "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
    public: { http: [RPC_URL] },
  },
  blockExplorers: {
    default: { name: "Explorer", url: explorer },
  },
  testnet: CHAIN_ID !== 4663,
});
