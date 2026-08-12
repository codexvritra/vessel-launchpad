import { getDefaultConfig, connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, fallback, http, webSocket } from "wagmi";
import { robinhoodChain } from "./chain";
import { RPC_URL, WC_PROJECT_ID, WS_RPC_URL } from "./config";

/**
 * Single shared wagmi + RainbowKit config, created lazily on the client only
 * (see providers.tsx) so nothing touches wallet globals during SSR/build.
 *
 * WalletConnect requires a real Cloud project id. Without one we fall back to a
 * browser-wallet (injected / MetaMask) connector — no WalletConnect, no 403s, and
 * connecting works locally. Set NEXT_PUBLIC_WC_PROJECT_ID to a real id to enable
 * the full RainbowKit wallet list (mobile QR, etc.).
 */
let cached: ReturnType<typeof getDefaultConfig> | ReturnType<typeof createConfig> | null = null;

const PLACEHOLDER = "wallet_placeholder_project_id";

export function getWagmiConfig() {
  if (cached) return cached;

  const transport = WS_RPC_URL
    ? fallback([webSocket(WS_RPC_URL), http(RPC_URL)])
    : http(RPC_URL);

  const hasRealWc = !!WC_PROJECT_ID && WC_PROJECT_ID !== PLACEHOLDER;

  if (hasRealWc) {
    cached = getDefaultConfig({
      appName: "Signapad",
      projectId: WC_PROJECT_ID,
      chains: [robinhoodChain],
      transports: { [robinhoodChain.id]: transport },
      ssr: true,
    });
  } else {
    // Browser-wallet only — no WalletConnect dependency.
    const connectors = connectorsForWallets(
      [{ groupName: "Browser wallet", wallets: [injectedWallet] }],
      { appName: "Signapad", projectId: PLACEHOLDER },
    );
    cached = createConfig({
      chains: [robinhoodChain],
      connectors,
      transports: { [robinhoodChain.id]: transport },
      ssr: true,
    });
  }
  return cached;
}
