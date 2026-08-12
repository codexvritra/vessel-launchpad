import { createConfig, factory } from "ponder";
import { getAbiItem, zeroAddress } from "viem";
import {
  CollectionFactoryAbi,
  LaunchpadERC721Abi,
  TBAGuardAbi,
  LaunchpadHookAbi,
  FeeSplitterAbi,
  CoinFactoryAbi,
  MarketDeployerAbi,
  BondingCurveAbi,
  TokenLauncherAbi,
  ERC20Abi,
} from "./abis";

const chainId = Number(process.env.CHAIN_ID ?? 31337);
const rpc = process.env.ROBINHOOD_RPC_URL ?? "http://127.0.0.1:8545";
const startBlock = Number(process.env.START_BLOCK ?? 0);

const addr = (v: string | undefined) => (v ?? zeroAddress) as `0x${string}`;
const FACTORY = addr(process.env.FACTORY_ADDRESS);

// Backing assets to watch for ERC-20 movements in/out of TBAs (comma-separated).
const BACKING_ASSETS = (process.env.BACKING_ASSETS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean) as `0x${string}`[];

// Contracts are always registered (with a zero-address fallback when an address is
// unset) so event-name types are stable; a zero address simply matches no logs.
export default createConfig({
  chains: {
    robinhood: { id: chainId, rpc },
  },
  contracts: {
    // Primary indexer event source.
    CollectionFactory: {
      chain: "robinhood",
      abi: CollectionFactoryAbi,
      address: FACTORY,
      startBlock,
    },

    // Every collection the factory has ever deployed, registered dynamically —
    // this is how we index Transfer + TokenBoundAccountFunded from contracts whose
    // addresses are not known ahead of time.
    Collection: {
      chain: "robinhood",
      abi: LaunchpadERC721Abi,
      address: factory({
        address: FACTORY,
        event: getAbiItem({ abi: CollectionFactoryAbi, name: "CollectionCreated" }),
        parameter: "collection",
      }),
      startBlock,
    },

    TBAGuard: {
      chain: "robinhood",
      abi: TBAGuardAbi,
      address: addr(process.env.GUARD_ADDRESS),
      startBlock,
    },
    LaunchpadHook: {
      chain: "robinhood",
      abi: LaunchpadHookAbi,
      address: addr(process.env.HOOK_ADDRESS),
      startBlock,
    },
    FeeSplitter: {
      chain: "robinhood",
      abi: FeeSplitterAbi,
      address: addr(process.env.FEE_SPLITTER_ADDRESS),
      startBlock,
    },
    CoinFactory: {
      chain: "robinhood",
      abi: CoinFactoryAbi,
      address: addr(process.env.COIN_FACTORY_ADDRESS),
      startBlock,
    },
    MarketDeployer: {
      chain: "robinhood",
      abi: MarketDeployerAbi,
      address: addr(process.env.MARKET_DEPLOYER_ADDRESS),
      startBlock,
    },
    BondingCurve: {
      chain: "robinhood",
      abi: BondingCurveAbi,
      address: addr(process.env.BONDING_CURVE_ADDRESS),
      startBlock,
    },
    TokenLauncher: {
      chain: "robinhood",
      abi: TokenLauncherAbi,
      address: addr(process.env.TOKEN_LAUNCHER_ADDRESS),
      startBlock,
    },
    BackingAsset: {
      chain: "robinhood",
      abi: ERC20Abi,
      address: BACKING_ASSETS.length ? BACKING_ASSETS : [zeroAddress],
      startBlock,
    },
  },
});
