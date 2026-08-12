#!/usr/bin/env bash
# Vessel deploy runner. Turnkey for testnet; hard-gated for mainnet.
#
# Usage:
#   ./script/deploy.sh testnet          # deploy the core stack to testnet
#   ./script/deploy.sh testnet --seed   # + deploy & mint the flagship collection
#   ./script/deploy.sh mainnet          # refuses unless every gate in .env.mainnet is "yes"
#
# The deployer key is NEVER read from a file. Import it into Foundry's keystore
# first (`cast wallet import <name> --interactive`) and set DEPLOYER_ACCOUNT.
set -euo pipefail

NETWORK="${1:-}"
SEED="${2:-}"
if [[ "$NETWORK" != "testnet" && "$NETWORK" != "mainnet" ]]; then
  echo "usage: $0 <testnet|mainnet> [--seed]" >&2
  exit 2
fi

ENV_FILE=".env.${NETWORK}"
[[ -f "$ENV_FILE" ]] || { echo "missing $ENV_FILE (copy from $ENV_FILE.example)" >&2; exit 2; }
set -a; # shellcheck disable=SC1090
source "$ENV_FILE"; set +a

# --- resolve RPC per network ---
if [[ "$NETWORK" == "testnet" ]]; then
  RPC="${ROBINHOOD_TESTNET_RPC_URL:-}"
else
  RPC="${ROBINHOOD_RPC_URL:-}"
fi
[[ -n "$RPC" ]] || { echo "RPC URL is empty in $ENV_FILE" >&2; exit 2; }
[[ -n "${DEPLOYER_ACCOUNT:-}" ]] || { echo "DEPLOYER_ACCOUNT is empty" >&2; exit 2; }

# --- MAINNET HARD GATES ---
if [[ "$NETWORK" == "mainnet" ]]; then
  echo "== MAINNET pre-flight =="
  fail=0
  for gate in AUDIT_COMPLETE LEGAL_OPINION TESTNET_VERIFIED OWNER_IS_MULTISIG; do
    val="${!gate:-no}"
    if [[ "$val" != "yes" ]]; then
      echo "  ✗ $gate is '$val' (must be 'yes')"; fail=1
    else
      echo "  ✓ $gate"
    fi
  done
  if [[ "$fail" == "1" ]]; then
    echo ""
    echo "REFUSING to deploy to mainnet: unmet gates above." >&2
    echo "Mainnet is audit- and legal-gated. See ../LEGAL.md and docs/AUDIT.md." >&2
    exit 1
  fi
  read -r -p "All gates green. Type 'DEPLOY MAINNET' to proceed: " confirm
  [[ "$confirm" == "DEPLOY MAINNET" ]] || { echo "aborted."; exit 1; }
fi

# --- verification flags (only if explorer creds present) ---
VERIFY_ARGS=()
if [[ -n "${EXPLORER_API_URL:-}" && -n "${EXPLORER_API_KEY:-}" ]]; then
  VERIFY_ARGS=(--verify --verifier-url "$EXPLORER_API_URL" --etherscan-api-key "$EXPLORER_API_KEY")
fi

echo "== Deploying core stack to $NETWORK =="
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC" \
  --account "$DEPLOYER_ACCOUNT" \
  --broadcast --slow "${VERIFY_ARGS[@]}"

echo ""
echo "Core stack deployed. Copy the printed CollectionFactory address into your"
echo "indexer/services/web .env files (see ../DEPLOY.md §3)."

# --- optional flagship seed ---
if [[ "$SEED" == "--seed" ]]; then
  echo ""
  read -r -p "FACTORY address to seed the flagship into: " FACTORY
  [[ -n "$FACTORY" ]] || { echo "no factory address; skipping seed."; exit 0; }
  echo "== Seeding flagship 'Vessel Founders' =="
  FACTORY="$FACTORY" forge script script/SeedFlagship.s.sol:SeedFlagship \
    --rpc-url "$RPC" --account "$DEPLOYER_ACCOUNT" --broadcast
fi

echo ""
echo "Done. Run the acceptance checklist in ../DEPLOY.md §6."
