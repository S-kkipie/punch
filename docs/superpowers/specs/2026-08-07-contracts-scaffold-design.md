# PUNCH — Sub-project 1: Contracts scaffold (design)

**Status:** Approved design; pending implementation plan
**Date:** 2026-08-07
**Parent spec:** `2026-08-07-punch-master-spec.md` (canonical authority; this doc only scopes scaffold work)

## Purpose

Create the minimal on-chain workspace and TypeScript chain glue so every later
sub-project (one per contract, then backend domains, then frontends) has a
compiling, testable foundation. No economic logic ships here.

## Roadmap context

The master spec is decomposed into sub-projects, each with its own
spec → plan → implementation cycle:

1. **Contracts scaffold** ← this document
2. `MockPEN` + `CafeRegistry`
3. `PlanManager`
4. `ConsumptionLog`
5. `PunchVault`
6. `NetworkFund`
7. `CampaignEscrow`
8. Backend domains (`src/core/cafe`, `src/core/plan`, indexer/relayer stubs)
9. Consumer PWA flows
10. Café panel
11. Ops console + reconciliation
12. Seed data: four-café simulation

## Scope

### In

- pnpm workspace: `pnpm-workspace.yaml` with `packages/*`; the existing
  Next.js app remains at the repo root (zero path churn).
- `packages/contracts`: Foundry workspace, package name `@punch/contracts`.
- One Solidity interface per master-spec §16 contract, declaring the
  conceptual operations and events verbatim:
  `ICafeRegistry`, `IPlanManager`, `IConsumptionLog`, `IPunchVault`,
  `INetworkFund`, `ICampaignEscrow`, `IMockPEN`.
- One empty implementation contract per interface. Every function body
  reverts with custom error `NotImplemented()`.
- `test/Scaffold.t.sol`: deploys each implementation and asserts
  unimplemented functions revert with `NotImplemented()`.
- `script/Deploy.s.sol`: stub deploy script (compiles; not wired to any RPC).
- OpenZeppelin contracts installed as a dependency; not imported yet.
- TS chain glue in `src/core/chain`:
  - `chain.ts` — Arbitrum Sepolia (chain id 421614) config and a
    `publicClient` factory using viem.
  - `abis.ts` — re-exports ABIs from `packages/contracts` build artifacts
    (placeholder export until codegen lands in a later sub-project).
  - `addresses.ts` — per-environment contract address map, zero addresses
    for now.
- Root `package.json`: add `viem` dependency and `contracts:build`,
  `contracts:test` scripts delegating to the contracts package.

### Out

- Any business/economic logic (splits, reserve invariant, burns, payouts).
- ABI codegen tooling (arrives with first real contract sub-project).
- Deploy to any network.
- Backend domains, indexer, relayer, frontends.

## Conventions

- Solidity `^0.8.30`.
- Interfaces mirror master spec §16 operation and event names exactly.
- TS side follows `docs/code-review/*` conventions where applicable
  (no zod schemas needed at this stage).

## Testing / acceptance

- `forge build` compiles clean.
- `forge test` passes: each impl deploys; each interface function reverts
  `NotImplemented()`.
- Vitest: `src/core/chain` — chain id equals 421614; address map contains an
  entry per contract with a valid (zero) address.
- `pnpm typecheck` and `pnpm check` pass at root.

## Error handling

Not applicable beyond the `NotImplemented()` revert convention; real error
taxonomy is defined per-contract in later sub-specs.
