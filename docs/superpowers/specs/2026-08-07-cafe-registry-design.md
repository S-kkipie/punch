# CafeRegistry — Design Spec (sub-project 2b)

**Date:** 2026-08-07
**Parent spec:** `docs/superpowers/specs/2026-08-07-punch-master-spec.md` (§16 `CafeRegistry`, §02 invariants, §07 café product rules, §20 security controls)
**Scaffold spec:** `docs/superpowers/specs/2026-08-07-contracts-scaffold-design.md` (roadmap item 2, split: 2a MockPEN, 2b CafeRegistry)

## Goal

Replace the `CafeRegistry` scaffold stub with the working on-chain roster of member cafés. It answers the three questions every later contract asks before moving anything:

1. Does this café exist, and is it operational?
2. May this address act on that café's behalf?
3. Is this product approved for emission / for reward?

It moves no value: no PUNCH, no reserve, no PEN. Identity and permissions only. This is why it is the first real contract — `PlanManager`, `ConsumptionLog`, `PunchVault`, `NetworkFund` and `CampaignEscrow` all read from it.

Master-spec grounding: invariant §13 ("Arbitrum manda; Postgres proyecta") is the reason the roster lives on-chain at all. Keeping the authorized-café list on-chain makes registrations and status changes auditable through events and `cafeCount`, and gives the admin a direct role-revocation path if the ops backend is compromised; it does not by itself prevent the registrar from adding and activating a phantom café.

## Scope

In: `CafeRegistry.sol` implementation, `ICafeRegistry.sol` extension, `CafeRegistry.t.sol` tests, removal of the CafeRegistry entry from `Scaffold.t.sol`, and the corresponding §16 update to the master spec.

Out: `Deploy.s.sol` and any deploy script (nothing else exists to wire yet), `src/core/chain/abis.ts` (codegen still deferred per the scaffold ruling), any other contract, any UI.

## Decisions (user-approved)

1. **Access control: OpenZeppelin `AccessControl`, two roles.** `DEFAULT_ADMIN_ROLE` (PUNCH multisig — grants and revokes) and `REGISTRAR_ROLE` (PUNCH ops backend — `registerCafe`, `setCafeStatus`). Café-scoped writes need no role: they are gated on café ownership. Satisfies §20 "roles mínimos" and "treasury/admin separados".
2. **Products: eligibility bit only.** On-chain state per `(cafeId, productId, kind)` is a boolean. Retail price, COGS, and the invariant §02.6 "retail ≤ S/12" vetting stay off-chain in PUNCH ops and Postgres; the chain records the approval decision, not the catalogue.

   *Rationale (considered and rejected: storing retail price on-chain).* No contract reads a price to settle anything — payout is fixed S/3.60 (§02.7), reserve is fixed S/0.30 (§02.9), emission is 1 PUNCH per valid purchase regardless of amount (§02.2). An on-chain price would be a write path nobody reads, would go stale silently whenever a café updates its menu, and would still not stop the fraud that matters (a café *declaring* a false price). §20 already places "catálogo aprobado" among operational controls, not contract invariants. Revisit only if payout ever becomes a percentage of retail — then the number decides money and must live where the chain rules.
3. **Status transitions: enforced state machine, `Exited` terminal.**

   ```text
   Pending   -> Active | Exited
   Active    -> Suspended | Exited
   Suspended -> Active | Exited
   Exited    -> (nothing)
   ```

   A no-op transition (same status) reverts. A café that leaves does not come back on the same `cafeId`; it re-registers and gets a new one. This keeps a café suspended for fraud from being restored by a mis-click, and keeps history unambiguous.
4. **Owner is implicitly authorized; ownership transfers in two steps.** `isAuthorized` is true for the owner and for any active operator, so the owner never has to authorize itself. Transfer is propose/accept so a café cannot be sent to an address that cannot claim it.
5. **No `Pausable`.** §20 lists "pausable por contrato específico" as an MVP control, and it belongs on the contracts that move value (`PunchVault`, `PlanManager`) — not here. Pausing the registry would block `setCafeStatus`, the exact tool needed during an incident, while stopping no economic activity. The granular brake is `setCafeStatus(id, Suspended)`; a compromised registrar key is answered by `revokeRole`, which is more precise than a global freeze.
6. **A café that is not `Pending` or `Active` cannot configure itself.** `authorizeOperator` and `setEligibleProduct` revert for `Suspended` and `Exited` cafés — a café frozen for risk must not be able to reshuffle its catalogue or its signing keys.

## Interface changes

`ICafeRegistry` as merged in sub-project 1 has four writes and **zero reads**, which makes it unusable by its consumers: `ConsumptionLog` must be able to ask "does this address sign for this café?". Unlike `IMockPEN` (frozen in 2a), this interface must grow.

Added:

```solidity
// reads
function getCafe(uint256 cafeId) external view returns (address owner, CafeStatus status);
function isAuthorized(uint256 cafeId, address account) external view returns (bool);
function isEligible(uint256 cafeId, uint256 productId, ProductKind kind) external view returns (bool);
function isOperational(uint256 cafeId) external view returns (bool); // status == Active
function cafeCount() external view returns (uint256);

// ownership
function proposeOwner(uint256 cafeId, address newOwner) external;
function acceptOwnership(uint256 cafeId) external;

// events
event CafeOwnerProposed(uint256 indexed cafeId, address indexed proposed);
event CafeOwnerTransferred(uint256 indexed cafeId, address indexed prev, address indexed next);
event OperatorAuthorized(uint256 indexed cafeId, address indexed operator, bool authorized);
```

`isOperational` exists so consumer contracts need neither the enum nor a duplicated comparison — one question, one place to change it.

Unchanged: the `CafeStatus` and `ProductKind` enums, the four existing write signatures, and the three existing events.

This extends master spec §16, which lists only four operations and three events. Per the sub-project 1 ruling that scaffold-chosen details are provisional and refinable within each contract's sub-project, §16 is updated in the same commit so the master spec does not go stale.

## Contract design

`packages/contracts/src/CafeRegistry.sol` — inherits OpenZeppelin `AccessControl` and `ICafeRegistry`.

```solidity
struct Cafe {
    address owner;
    address pendingOwner;
    CafeStatus status;
}
mapping(uint256 => Cafe) private _cafes;
mapping(uint256 => mapping(address => bool)) private _operators;
mapping(uint256 => mapping(uint256 => mapping(ProductKind => bool))) private _eligible;
uint256 private _nextCafeId; // first assigned id is 1
```

`cafeId` starts at 1 so that 0 is a free sentinel for "does not exist" — `getCafe(0)` must not look like a real café owned by `address(0)`.

Constructor takes the admin address and grants it `DEFAULT_ADMIN_ROLE`. `REGISTRAR_ROLE` is granted separately by the admin; the constructor does not self-grant it, keeping the ops key distinct from the multisig from the first block.

| Function | Caller | Extra requirements |
|---|---|---|
| `registerCafe(owner)` | `REGISTRAR_ROLE` | `owner != address(0)`. Café is created `Pending`. Returns the new `cafeId`. |
| `setCafeStatus(id, s)` | `REGISTRAR_ROLE` | Café exists; transition valid per the state machine; `s` differs from current. |
| `authorizeOperator(id, op, bool)` | café owner | Café is `Pending` or `Active`; `op != address(0)`; the flag actually changes. |
| `setEligibleProduct(id, pid, kind, bool)` | café owner | Café is `Pending` or `Active`; the flag actually changes. |
| `proposeOwner(id, next)` | café owner | Café not `Exited`; `next != address(0)`; `next != owner`. Overwrites any prior proposal. |
| `acceptOwnership(id)` | the proposed address | Clears `pendingOwner`. Operators and product eligibility survive the transfer. |
| `grantRole` / `revokeRole` | `DEFAULT_ADMIN_ROLE` | OZ standard. |

Custom errors, no revert strings:

```solidity
error CafeNotFound(uint256 cafeId);
error InvalidStatusTransition(CafeStatus from, CafeStatus to);
error NotCafeOwner(uint256 cafeId, address caller);
error CafeNotConfigurable(uint256 cafeId, CafeStatus status);
error NotPendingOwner(uint256 cafeId, address caller);
error ZeroAddress();
error NoStateChange();
```

`NoStateChange` — reverting on a write that changes nothing — is deliberate. A no-op write would still emit `ProductEligibilityChanged` or `OperatorAuthorized`, and the indexer would reprocess a change that never happened. Invariant §13 makes Postgres a projection of the chain; the chain should not emit empty statements.

## Boundary: what this contract does NOT do

`setCafeStatus(id, Exited)` touches no reserve and no balance. Invariant §08 ("balance permanece válido si café emisor abandona red") and §21 ("café cancela con PUNCH vivos → mantener reserva asignada") are obligations of `PunchVault` and `PlanManager` in sub-projects 3 and 5. The registry records the status change and nothing more. Stated explicitly here so a later sub-project does not assume the registry already handled it.

## Tests

`packages/contracts/test/CafeRegistry.t.sol` (forge), written test-first:

**Unit — happy paths and every custom error**

1. `registerCafe` assigns sequential ids from 1, sets owner, status `Pending`, emits `CafeRegistered`.
2. `registerCafe` with `address(0)` reverts `ZeroAddress`; without `REGISTRAR_ROLE` reverts OZ `AccessControlUnauthorizedAccount`.
3. `setCafeStatus` on an unknown id reverts `CafeNotFound`.
4. Full transition matrix: all 16 `(from, to)` pairs — the 6 valid ones succeed and emit `CafeStatusChanged`, the other 10 revert `InvalidStatusTransition` (same-status pairs included).
5. `authorizeOperator` / `setEligibleProduct` succeed for the owner and emit their events; reverts for a non-owner (`NotCafeOwner`), for the owner of a *different* café, for a `Suspended` or `Exited` café (`CafeNotConfigurable`), for a zero operator (`ZeroAddress`), and for a redundant write (`NoStateChange`).
6. `isAuthorized` true for owner and for an authorized operator, false after revocation, false for an unrelated address, false for an unknown café.
7. `isEligible` distinguishes `Emission` from `Reward` for the same `productId` — approving one must not approve the other.
8. `isOperational` true only for `Active`.

**Ownership transfer**

9. propose → accept moves ownership, emits both events, and the old owner loses `NotCafeOwner`-gated access.
10. A second `proposeOwner` invalidates the first proposal (the first proposee gets `NotPendingOwner`).
11. `acceptOwnership` from a non-proposed address reverts `NotPendingOwner`.
12. Operators and product eligibility survive the transfer.
13. `proposeOwner` on an `Exited` café reverts.

**Fuzz**

14. `registerCafe` over random owners keeps ids unique and `cafeCount` exact.
15. `isAuthorized(id, addr)` is false for any address never made owner or operator.
16. `setEligibleProduct` over random `productId`s: `isEligible` reflects exactly the last write for that `(cafeId, productId, kind)` triple.

**Invariant** (§20 asks for invariant/fuzz tests)

17. No café ever leaves `Exited` — a handler calling `setCafeStatus` with random inputs can never restore an exited café.

`Scaffold.t.sol`: delete only the CafeRegistry `NotImplemented` test; every other contract's scaffold test stays.

## Parallel-work coordination

Sub-project 2a (MockPEN) has already merged to `main`; this worktree branches from that state, so the `Scaffold.t.sol` conflict anticipated during design does not arise. Files touched here are otherwise disjoint from any other in-flight work, except the master spec §16 edit.

## Open items deferred

- Deploy script and constructor-argument wiring: deferred until `PlanManager` (sub-project 3) gives the registry a consumer worth deploying alongside.
- `abis.ts` codegen: still deferred per the scaffold ruling.
- Batch operations (`authorizeOperator` over an array, bulk product approval): YAGNI until the café panel shows a real need.
