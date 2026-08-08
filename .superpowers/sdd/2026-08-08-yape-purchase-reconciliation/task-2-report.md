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

`pnpm chain:deploy` was also attempted exactly as specified, but the initial checkout had no `.env` file and tsx exited before running with `node: .env: not found`. The command subsequently ran successfully after the local `.env` was provisioned.

## Review fix

- Changed `seedCafe` to accept `ownerWalletIndex` and return the derived `ownerAddress`, removing the hidden 20-account limit.
- Seed now funds the derived owner with 1 ETH from the deployer so arbitrary high wallet indexes can submit owner-only setup transactions on anvil.
- Added `CHAIN_ENV="local"` and `CHAIN_RPC_URL="http://127.0.0.1:8545"` to `.env.example`.

Fix verification:

- `pnpm typecheck` — passed.
- `pnpm exec biome check scripts/dev-chain.ts .env.example` — passed for the checked script (the env example is not a Biome source file).
- `pnpm chain:deploy` — passed; wrote 7 non-zero addresses.
- High-index fixture via `seedCafe({ ownerWalletIndex: 25 })` — returned café 2 and owner `0xDf37F81dAAD2b0327A0A50003740e1C935C70913`.
- `cast call CafeRegistry getCafe(2)` — status `1` (`Active`).
- `cast call PlanManager credits(2)` — `100`.
- Address map check — `7`.

The deployment and high-index verification ran against the already-running anvil at `http://127.0.0.1:8545`.

## Files touched by the review fix

- `scripts/dev-chain.ts`
- `.env.example`
- `src/core/chain/addresses.local.json`
- This report
