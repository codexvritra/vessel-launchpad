#!/usr/bin/env bash
# =============================================================================
# Vessel — one-shot launchpad deploy for Robinhood Chain MAINNET (chain 4663).
#
# Deploys the whole stack (CollectionFactory, LaunchpadERC721A, TokenLauncher,
# CoinFactory, market deployer, bonding curve, TBAGuard, FeeSplitter, 6551 impl),
# parses every deployed address, and writes them straight into:
#     web/.env.local      (frontend)
#     indexer/.env        (Ponder indexer)
# then prints a copy-paste block for Vercel.
#
# RUN IT (from the repo's `contracts/` folder, in Git Bash):
#     bash deploy-launchpad.sh
#
# Requirements: Foundry (forge, cast) installed, and the deployer address funded
# with ETH on Robinhood Chain mainnet for gas. Your private key never leaves this
# machine — it is either read from Foundry's encrypted keystore, or typed into a
# hidden prompt and used only for this run.
# =============================================================================
set -euo pipefail

# ---- network config (override by exporting these before running) ------------
RPC="${ROBINHOOD_RPC_URL:-https://rpc.mainnet.chain.robinhood.com}"
CHAIN_ID="${CHAIN_ID:-4663}"
# Uniswap V2 router on Robinhood mainnet (shares the V2 interface our deployer uses).
SUSHI_ROUTER="${SUSHI_ROUTER:-0x89e5db8b5aa49aa85ac63f691524311aeb649eba}"
# Optional real Chainlink ETH/USD feed (a $3000 mock is used if left empty).
ETH_USD_FEED="${ETH_USD_FEED:-}"

# ---- sanity checks ----------------------------------------------------------
command -v forge >/dev/null 2>&1 || { echo "ERROR: forge not found. Install Foundry: https://getfoundry.sh"; exit 1; }
command -v cast  >/dev/null 2>&1 || { echo "ERROR: cast not found. Install Foundry: https://getfoundry.sh"; exit 1; }
[[ -f foundry.toml ]] || { echo "ERROR: run this from the contracts/ folder (no foundry.toml here)."; exit 1; }

# ---- signer: keystore account (preferred) or hidden key prompt --------------
SIGNER_ARGS=()
if [[ -n "${DEPLOYER_ACCOUNT:-}" ]]; then
  SIGNER_ARGS=(--account "$DEPLOYER_ACCOUNT")
  DEPLOYER_ADDR="$(cast wallet address --account "$DEPLOYER_ACCOUNT")"
else
  echo "No DEPLOYER_ACCOUNT set. Paste your deployer private key (input hidden)."
  read -r -s -p "PRIVATE KEY: " PK </dev/tty; echo
  [[ -n "${PK:-}" ]] || { echo "ERROR: no key entered."; exit 1; }
  SIGNER_ARGS=(--private-key "$PK")
  DEPLOYER_ADDR="$(cast wallet address --private-key "$PK")"
fi
export PROTOCOL_RECIPIENT="${PROTOCOL_RECIPIENT:-$DEPLOYER_ADDR}"

echo ""
echo "  Network        : Robinhood Chain (chain $CHAIN_ID)"
echo "  RPC            : $RPC"
echo "  Deployer       : $DEPLOYER_ADDR"
echo "  Fee recipient  : $PROTOCOL_RECIPIENT"
echo "  DEX router     : $SUSHI_ROUTER"

# ---- balance check ----------------------------------------------------------
BAL_WEI="$(cast balance "$DEPLOYER_ADDR" --rpc-url "$RPC")"
echo "  Balance (wei)  : $BAL_WEI"
if [[ "$BAL_WEI" == "0" ]]; then
  echo "ERROR: deployer has 0 ETH on chain $CHAIN_ID. Fund it for gas and retry."; exit 1
fi

# ---- explicit confirmation (real money, unaudited) --------------------------
echo ""
echo "This broadcasts real transactions to MAINNET with real ETH. The contracts"
echo "are unaudited. Proceed only if you accept that risk."
CONFIRM=""
while [[ -z "$CONFIRM" ]]; do
  read -r -p "Type 'DEPLOY MAINNET' to continue (Ctrl+C to abort): " CONFIRM </dev/tty || true
  CONFIRM="${CONFIRM%$'\r'}"                                            # strip Windows CR
  CONFIRM="$(printf '%s' "$CONFIRM" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
done
if [[ "$CONFIRM" != "DEPLOY MAINNET" ]]; then
  echo "Aborted (you typed: '$CONFIRM')."; exit 1
fi

# ---- record the start block for the indexer ---------------------------------
START_BLOCK="$(cast block-number --rpc-url "$RPC")"

# ---- deploy -----------------------------------------------------------------
export SUSHI_ROUTER
[[ -n "$ETH_USD_FEED" ]] && export ETH_USD_FEED
OUT="$(mktemp)"
trap 'unset PK 2>/dev/null || true; rm -f "$OUT"' EXIT

echo ""
echo "== Deploying (this can take a minute) =="
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC" "${SIGNER_ARGS[@]}" \
  --broadcast --slow 2>&1 | tee "$OUT"

# ---- parse every logged address ---------------------------------------------
grab() { grep -iE "$1" "$OUT" | grep -oiE "0x[0-9a-fA-F]{40}" | head -1; }
FACTORY="$(grab 'CollectionFactory')"
COLLECTION_IMPL="$(grab 'LaunchpadERC721A')"
FEE_SPLITTER="$(grab 'FeeSplitter')"
GUARD="$(grab 'TBAGuard')"
ACCOUNT_IMPL="$(grab 'AccountImpl')"
REGISTRY="$(grab 'Registry\(6551\)')"
COIN_FACTORY="$(grab 'CoinFactory')"
MARKET_DEPLOYER="$(grab 'SushiMarketDeploy')"
LIQUIDITY_LAUNCHER="$(grab 'LiquidityLauncher')"
TOKEN_LAUNCHER="$(grab 'TokenLauncher')"
BONDING_CURVE="$(grab 'BondingCurve')"

[[ -n "$FACTORY" ]] || { echo "ERROR: could not parse CollectionFactory address — check the deploy output above."; exit 1; }

# ---- write frontend + indexer env files -------------------------------------
ROOT="$(cd .. && pwd)"
WEB_ENV="$ROOT/web/.env.local"
IDX_ENV="$ROOT/indexer/.env"

cat > "$WEB_ENV" <<EOF
# Auto-generated by deploy-launchpad.sh — Robinhood Chain mainnet
NEXT_PUBLIC_CHAIN_ID=$CHAIN_ID
NEXT_PUBLIC_RPC_URL=$RPC
NEXT_PUBLIC_FACTORY=$FACTORY
NEXT_PUBLIC_TOKEN_LAUNCHER=$TOKEN_LAUNCHER
NEXT_PUBLIC_GUARD=$GUARD
NEXT_PUBLIC_FEE_SPLITTER=$FEE_SPLITTER
NEXT_PUBLIC_COIN_FACTORY=$COIN_FACTORY
NEXT_PUBLIC_MARKET_DEPLOYER=$MARKET_DEPLOYER
NEXT_PUBLIC_LIQUIDITY_LAUNCHER=$LIQUIDITY_LAUNCHER
NEXT_PUBLIC_BONDING_CURVE=$BONDING_CURVE
EOF

cat > "$IDX_ENV" <<EOF
# Auto-generated by deploy-launchpad.sh — Robinhood Chain mainnet
CHAIN_ID=$CHAIN_ID
ROBINHOOD_RPC_URL=$RPC
START_BLOCK=$START_BLOCK
FACTORY_ADDRESS=$FACTORY
GUARD_ADDRESS=$GUARD
FEE_SPLITTER_ADDRESS=$FEE_SPLITTER
COIN_FACTORY_ADDRESS=$COIN_FACTORY
MARKET_DEPLOYER_ADDRESS=$MARKET_DEPLOYER
BONDING_CURVE_ADDRESS=$BONDING_CURVE
TOKEN_LAUNCHER_ADDRESS=$TOKEN_LAUNCHER
EOF

# ---- summary ----------------------------------------------------------------
echo ""
echo "============================================================"
echo " VESSEL LAUNCHPAD DEPLOYED (chain $CHAIN_ID, block $START_BLOCK)"
echo "============================================================"
printf "  %-22s %s\n" "CollectionFactory"  "$FACTORY"
printf "  %-22s %s\n" "TokenLauncher"      "$TOKEN_LAUNCHER"
printf "  %-22s %s\n" "TBAGuard"           "$GUARD"
printf "  %-22s %s\n" "FeeSplitter"        "$FEE_SPLITTER"
printf "  %-22s %s\n" "CoinFactory"        "$COIN_FACTORY"
printf "  %-22s %s\n" "MarketDeployer"     "$MARKET_DEPLOYER"
printf "  %-22s %s\n" "LiquidityLauncher"  "$LIQUIDITY_LAUNCHER"
printf "  %-22s %s\n" "BondingCurve"       "$BONDING_CURVE"
printf "  %-22s %s\n" "LaunchpadERC721A"   "$COLLECTION_IMPL"
printf "  %-22s %s\n" "AccountImpl(6551)"  "$ACCOUNT_IMPL"
printf "  %-22s %s\n" "Registry(6551)"     "$REGISTRY"
echo ""
echo "Wrote: $WEB_ENV"
echo "Wrote: $IDX_ENV"
echo ""
echo "---- Paste these into Vercel > Project > Settings > Environment Variables ----"
echo "NEXT_PUBLIC_CHAIN_ID=$CHAIN_ID"
echo "NEXT_PUBLIC_RPC_URL=$RPC"
echo "NEXT_PUBLIC_FACTORY=$FACTORY"
echo "NEXT_PUBLIC_TOKEN_LAUNCHER=$TOKEN_LAUNCHER"
echo "NEXT_PUBLIC_GUARD=$GUARD"
echo "NEXT_PUBLIC_FEE_SPLITTER=$FEE_SPLITTER"
echo "NEXT_PUBLIC_COIN_FACTORY=$COIN_FACTORY"
echo "NEXT_PUBLIC_MARKET_DEPLOYER=$MARKET_DEPLOYER"
echo "NEXT_PUBLIC_LIQUIDITY_LAUNCHER=$LIQUIDITY_LAUNCHER"
echo "NEXT_PUBLIC_BONDING_CURVE=$BONDING_CURVE"
echo "-----------------------------------------------------------------------------"
echo ""
echo "Next: restart the indexer (cd ../indexer && pnpm dev) and redeploy the web app."
