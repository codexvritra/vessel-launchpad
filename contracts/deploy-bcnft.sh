#!/usr/bin/env bash
# =============================================================================
# Deploy the BONDING-CURVE NFT launchpad to Robinhood Chain mainnet (chain 4663).
# Standalone — does not touch your already-deployed contracts.
#
# Run from the repo's contracts/ folder in Git Bash:
#     bash deploy-bcnft.sh
#
# Requires Foundry (forge, cast) and a funded deployer. Your key stays local
# (keystore via DEPLOYER_ACCOUNT, or a hidden prompt). Prints the factory address
# and writes NEXT_PUBLIC_BCNFT_FACTORY into web/.env.local.
# =============================================================================
set -euo pipefail

RPC="${ROBINHOOD_RPC_URL:-https://rpc.mainnet.chain.robinhood.com}"
CHAIN_ID="${CHAIN_ID:-4663}"
# Reuse the ETH/USD feed from the main deploy (a $3000 mock) so the $3 launch fee
# matches. Override by exporting ETH_USD_FEED.
ETH_USD_FEED="${ETH_USD_FEED:-0xF5559A8Fd27f2417eC8C9b557C31b77e1a9Dc85A}"

command -v forge >/dev/null 2>&1 || { echo "ERROR: forge not found (install Foundry)."; exit 1; }
[[ -f foundry.toml ]] || { echo "ERROR: run this from the contracts/ folder."; exit 1; }

SIGNER_ARGS=()
if [[ -n "${DEPLOYER_ACCOUNT:-}" ]]; then
  SIGNER_ARGS=(--account "$DEPLOYER_ACCOUNT")
  DEPLOYER_ADDR="$(cast wallet address --account "$DEPLOYER_ACCOUNT")"
else
  read -r -s -p "PRIVATE KEY (hidden): " PK </dev/tty; echo
  [[ -n "${PK:-}" ]] || { echo "ERROR: no key."; exit 1; }
  SIGNER_ARGS=(--private-key "$PK")
  DEPLOYER_ADDR="$(cast wallet address --private-key "$PK")"
fi
export PROTOCOL_RECIPIENT="${PROTOCOL_RECIPIENT:-$DEPLOYER_ADDR}"
export ETH_USD_FEED

echo "  Deployer      : $DEPLOYER_ADDR"
echo "  Fee recipient : $PROTOCOL_RECIPIENT (gets \$3 launch fee + 1% buy/sell)"
echo "  ETH/USD feed  : $ETH_USD_FEED"
echo ""
read -r -p "Type 'DEPLOY' to deploy the bonding-curve NFT launchpad: " C </dev/tty
[[ "${C%$'\r'}" == "DEPLOY" ]] || { echo "Aborted."; exit 1; }

OUT="$(mktemp)"; trap 'unset PK 2>/dev/null || true; rm -f "$OUT"' EXIT
echo "== Deploying =="
forge script script/DeployBCNFT.s.sol:DeployBCNFT \
  --rpc-url "$RPC" "${SIGNER_ARGS[@]}" --broadcast --slow 2>&1 | tee "$OUT"

FACTORY="$(grep -iE 'BondingCurveNFTFactory' "$OUT" | grep -oiE '0x[0-9a-fA-F]{40}' | head -1)"
[[ -n "$FACTORY" ]] || { echo "ERROR: could not parse factory address."; exit 1; }

WEB_ENV="$(cd .. && pwd)/web/.env.local"
touch "$WEB_ENV"
# drop any old line, append the new one
grep -v '^NEXT_PUBLIC_BCNFT_FACTORY=' "$WEB_ENV" > "$WEB_ENV.tmp" 2>/dev/null || true
mv "$WEB_ENV.tmp" "$WEB_ENV" 2>/dev/null || true
echo "NEXT_PUBLIC_BCNFT_FACTORY=$FACTORY" >> "$WEB_ENV"

echo ""
echo "============================================================"
echo " BONDING-CURVE NFT LAUNCHPAD DEPLOYED"
echo "   Factory: $FACTORY"
echo "   Wrote NEXT_PUBLIC_BCNFT_FACTORY to $WEB_ENV"
echo "============================================================"
echo "Paste this to me and I'll wire the launch + buy/sell UI to it."
