# PennyPot

Buy 1¢ shares of [Megapot](https://megapot.io) lottery tickets. PennyPot fronts each
$1 ticket from a reserve, then sells it as 100 shares at 1¢ each; share proceeds
replenish the reserve. Each share pays out `ticketWinnings / sharesSold`, so an
undersubscribed ticket pays its holders more. See
[`packages/contracts/README.md`](packages/contracts/README.md) for the full spec.

## Monorepo layout

This is a [pnpm workspace](https://pnpm.io/workspaces).

```
packages/
  contracts/   Solidity contracts (Foundry) — the on-chain PennyPot
  web/         Webapp frontend (reserved; not yet implemented)
```

## Getting started

Contracts use [Foundry](https://book.getfoundry.sh/). From the repo root:

```bash
# install the forge-std submodule
git submodule update --init --recursive

# build + test the contracts
pnpm build
pnpm test

# or run forge directly inside the package
cd packages/contracts && forge test
```

## Deploying

```bash
cd packages/contracts
USDC_ADDRESS=... JACKPOT_ADDRESS=... FEE_RECEIVER=... \
  forge script script/Deploy.s.sol:Deploy --rpc-url $RPC_URL --broadcast --verify
```
