# Task 2 report

## Built

- Added `scripts/dev-chain.ts` with exported `deployAll(rpcUrl?)` and `seedCafe(opts)` helpers.
- Deployment reads forge artifacts directly, uses viem clients against anvil, and writes the local address map when run directly.
- Added package scripts `chain:anvil` and `chain:deploy`.
- Generated `src/core/chain/addresses.local.json` from the verified local deployment.

## Solidity constructor and wiring decisions

Deployment order is MockPEN, CafeRegistry, NetworkFund, PunchVault, PlanManager, ConsumptionLog, CampaignEscrow.

- `CafeRegistry` receives the deployer as its admin.
- `NetworkFund` receives MockPEN and CafeRegistry, then receives `setCampaignEscrow(CampaignEscrow)`.
- `PunchVault` receives MockPEN and CafeRegistry, then receives `setConsumptionLog(ConsumptionLog)`.
- `PlanManager` receives MockPEN, CafeRegistry, PunchVault, NetworkFund, and the deployer as treasury, then receives `setConsumptionLog(ConsumptionLog)`.
- `ConsumptionLog` receives CafeRegistry, PlanManager, and PunchVault; its constructor defaults were retained, including `minTicketAmount = 8e6`.
- `CampaignEscrow` receives MockPEN and CafeRegistry.
- The deployer is granted CafeRegistry's `REGISTRAR_ROLE` after deployment, matching the contract's AccessControl model.

`seedCafe` registers the requested owner, activates the café, marks the requested product (default 1) as `ProductKind.Emission`, mints 49 mPEN (6 decimals), approves PlanManager, and subscribes the café. The owner must be one of the first 20 addresses derived from `WALLET_MASTER_MNEMONIC`, so the helper can sign the owner-only transactions without importing `server-only` modules into the plain tsx script.

## Files touched

- `scripts/dev-chain.ts`
- `package.json`
- `src/core/chain/addresses.local.json`
- This report

## Commands and output

- `pnpm exec biome check --write scripts/dev-chain.ts package.json` — passed with no remaining issues.
- `pnpm typecheck` — passed.
- `pnpm exec tsx scripts/dev-chain.ts` with anvil running — deployed all seven contracts and seeded café 1 successfully.
- `cast call <ConsumptionLog> 'minTicketAmount()(uint256)' --rpc-url http://127.0.0.1:8545` — `8000000 [8e6]`.
- Address map check — 7 non-zero addresses.
- `cast call <PlanManager> 'credits(uint256)(uint256)' 1 --rpc-url http://127.0.0.1:8545` — `100`.

`pnpm chain:deploy` was also attempted exactly as specified, but this checkout has no `.env` file and tsx exits before running with `node: .env: not found`. Running the same script directly succeeds; the package command will work when the repository's expected `.env` exists.
