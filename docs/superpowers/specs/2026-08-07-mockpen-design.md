# MockPEN — Design Spec (sub-project 2a)

**Date:** 2026-08-07
**Parent spec:** `docs/superpowers/specs/2026-08-07-punch-master-spec.md` (§16 `MockPEN`, §02 invariants)
**Scaffold spec:** `docs/superpowers/specs/2026-08-07-contracts-scaffold-design.md` (roadmap item 2, split: 2a MockPEN, 2b CafeRegistry)

## Goal

Replace the `MockPEN` scaffold stub with a working mock ERC-20 PEN stablecoin for Arbitrum Sepolia. Per the master spec: "ERC-20 de prueba con faucet en Sepolia. No implica solución fiat productiva." It is the settlement token every other PUNCH contract moves.

## Scope

In: `MockPEN.sol` implementation, `MockPEN.t.sol` tests, `script/DeployMockPEN.s.sol`, removal of the MockPEN entry from `Scaffold.t.sol`.

Out: any change to `IMockPEN.sol` (frozen §16 interface), any other contract, chain glue updates (`abis.ts` codegen stays deferred), fiat integration of any kind.

## Decisions (user-approved)

1. **Decimals: 6** (USDC-style). `49 PEN = 49_000000`.
2. **Faucet: cap per call, no cooldown.** Max 1000 PEN per call; unlimited calls.
3. **Ops mint: `mint(address,uint256) onlyOwner`,** kept OUT of `IMockPEN` — the §16 interface stays untouched; deploy/seed scripts use the concrete contract.

## Contract design

`packages/contracts/src/MockPEN.sol`:

- Inherits OpenZeppelin `ERC20("Mock PEN", "mPEN")`, `Ownable(msg.sender)`, and `IMockPEN`.
- `decimals()` override returns `6`.
- `FAUCET_MAX` public constant = `1_000 * 1e6` (1000 PEN, 6 decimals).
- `faucet(uint256 amount)`: reverts `FaucetCapExceeded(requested, max)` (custom error) when `amount > FAUCET_MAX`; otherwise `_mint(msg.sender, amount)` and emits `FaucetDripped(msg.sender, amount)`. `amount == 0` is allowed (harmless no-op mint; no extra validation — YAGNI).
- `mint(address to, uint256 amount)`: `onlyOwner`, uncapped, plain `_mint`. No extra event — ERC20 `Transfer` from the zero address already records it.

No pause, no burn, no cooldown, no allowlist. It is a testnet mock.

## Tests

`packages/contracts/test/MockPEN.t.sol` (forge):

1. `decimals()` returns 6; name/symbol correct.
2. `faucet` mints to caller and emits `FaucetDripped`.
3. `faucet` at exactly `FAUCET_MAX` succeeds.
4. `faucet` above `FAUCET_MAX` reverts `FaucetCapExceeded`.
5. `mint` by owner credits target.
6. `mint` by non-owner reverts (OZ `OwnableUnauthorizedAccount`).
7. Standard transfer between accounts works (sanity that ERC20 wiring is intact).

`Scaffold.t.sol`: delete only the MockPEN `NotImplemented` test; every other contract's scaffold test stays.

## Deploy

`packages/contracts/script/DeployMockPEN.s.sol`: forge Script that deploys `MockPEN` (deployer becomes owner). The shared `Deploy.s.sol` stub is NOT touched.

## Parallel-work coordination

Sub-project 2b (CafeRegistry) runs in a parallel session branched from the same `main`. Disjoint files except `Scaffold.t.sol`, where each sub-project deletes only its own contract's test block. The resulting merge conflict (if any) is trivial and is resolved by whichever branch merges second — this session's controller handles the CafeRegistry merge.

## Error handling

- Faucet over cap → `FaucetCapExceeded(uint256 requested, uint256 max)`.
- Unauthorized ops mint → OZ `OwnableUnauthorizedAccount`.
- Everything else is standard OZ ERC20 behavior.

## Open items deferred

- `FaucetDripped` event shape was flagged provisional in the scaffold final review; this sub-project confirms it as-is (to, amount) — no change needed.
- ABI codegen into `src/core/chain/abis.ts` stays deferred until the backend sub-project (8) defines the codegen pipeline.
