# CafeRegistry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `CafeRegistry` scaffold stub with the working on-chain roster of member cafés — identity, status, authorized operators, and product eligibility.

**Architecture:** `CafeRegistry` inherits OpenZeppelin `AccessControl` and implements an extended `ICafeRegistry`. Two roles: `DEFAULT_ADMIN_ROLE` (multisig) and `REGISTRAR_ROLE` (PUNCH ops backend) gate registration and status changes; café-scoped writes are gated on café ownership instead of a role. Status follows an enforced state machine with `Exited` terminal. The contract moves no value — identity and permissions only.

**Tech Stack:** Solidity ^0.8.30, Foundry (forge), OpenZeppelin contracts (git submodule, remapping `@openzeppelin/contracts/`), forge-std.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-07-cafe-registry-design.md`; master spec `docs/superpowers/specs/2026-08-07-punch-master-spec.md` §16, §02, §07, §20.
- Do NOT touch any other contract (`PlanManager`, `ConsumptionLog`, `PunchVault`, `NetworkFund`, `CampaignEscrow`, `MockPEN`), any other interface, `script/*`, or `src/core/chain/*`.
- `ICafeRegistry.sol` IS modified here (it has zero read functions and is unusable by consumers). The existing `CafeStatus` / `ProductKind` enums, the four existing write signatures, and the three existing events stay byte-identical; only additions are allowed.
- Custom errors are free-standing in `CafeRegistry.sol` (same convention as `FaucetCapExceeded` in `MockPEN.sol`), never revert strings.
- `cafeId` is 1-based. Id `0` always means "does not exist".
- No `Pausable`. No batch operations. No on-chain product price.
- All forge commands run from `packages/contracts/`. Root shortcuts: `pnpm contracts:build`, `pnpm contracts:test`.
- Run `forge fmt` on changed `.sol` files before each commit.
- Every task ends green: `forge test` passes with zero failures.

## File structure

| File | Responsibility |
|---|---|
| `packages/contracts/src/interfaces/ICafeRegistry.sol` (modify) | The consumer-facing ABI: enums, events, writes, reads. What `ConsumptionLog` and `PunchVault` will import. |
| `packages/contracts/src/CafeRegistry.sol` (replace) | Storage, access control, state machine, the seven custom errors. |
| `packages/contracts/test/CafeRegistry.t.sol` (create) | Unit + fuzz tests. Grows task by task. |
| `packages/contracts/test/CafeRegistryInvariant.t.sol` (create) | Handler-based invariant: `Exited` is terminal. Separate file because it needs its own handler contract and its own `setUp`. |
| `packages/contracts/test/Scaffold.t.sol` (modify) | Drops CafeRegistry entirely — it is no longer a stub. |
| `docs/superpowers/specs/2026-08-07-punch-master-spec.md` (modify) | §16 `CafeRegistry` grows to match the shipped interface. |

---

### Task 1: Interface extension, storage, registration

**Files:**
- Modify: `packages/contracts/src/interfaces/ICafeRegistry.sol`
- Modify: `packages/contracts/src/CafeRegistry.sol` (replace stub entirely)
- Create: `packages/contracts/test/CafeRegistry.t.sol`
- Modify: `packages/contracts/test/Scaffold.t.sol`

**Interfaces:**
- Consumes: OZ `AccessControl` (`@openzeppelin/contracts/access/AccessControl.sol`), forge-std `Test`.
- Produces: `CafeRegistry(address admin)` constructor; `REGISTRAR_ROLE` public constant; `registerCafe(address) returns (uint256)`; `getCafe(uint256) returns (address, CafeStatus)`; `cafeCount() returns (uint256)`; errors `ZeroAddress()`, `CafeNotFound(uint256)`. Tasks 2–5 add methods to this same contract and tests to this same test file.

**Why Scaffold.t.sol changes now:** the constructor gains an `admin` argument, so `new CafeRegistry()` in `Scaffold.t.sol` stops compiling. CafeRegistry is no longer a stub, so its import, field, `setUp` line, and `NotImplemented` test all come out — along with the `ICafeRegistry` import, which only that test used.

- [ ] **Step 1: Write the failing test**

Create `packages/contracts/test/CafeRegistry.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {CafeRegistry, ZeroAddress, CafeNotFound} from "../src/CafeRegistry.sol";
import {ICafeRegistry} from "../src/interfaces/ICafeRegistry.sol";

contract CafeRegistryTest is Test {
    CafeRegistry internal registry;

    address internal admin = makeAddr("admin");
    address internal registrar = makeAddr("registrar");
    address internal owner1 = makeAddr("owner1");
    address internal owner2 = makeAddr("owner2");
    address internal operator = makeAddr("operator");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        registry = new CafeRegistry(admin);
        vm.prank(admin);
        registry.grantRole(registry.REGISTRAR_ROLE(), registrar);
    }

    /// @dev Registers a café owned by `who` and returns its id.
    function _register(address who) internal returns (uint256) {
        vm.prank(registrar);
        return registry.registerCafe(who);
    }

    function test_constructor_grantsAdminRole() public view {
        assertTrue(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), admin));
        assertFalse(registry.hasRole(registry.REGISTRAR_ROLE(), admin));
    }

    function test_constructor_zeroAdminReverts() public {
        vm.expectRevert(ZeroAddress.selector);
        new CafeRegistry(address(0));
    }

    function test_registerCafe_assignsSequentialIdsFromOne() public {
        uint256 first = _register(owner1);
        uint256 second = _register(owner2);
        assertEq(first, 1);
        assertEq(second, 2);
        assertEq(registry.cafeCount(), 2);
    }

    function test_registerCafe_startsPendingAndEmits() public {
        vm.expectEmit(true, true, false, false);
        emit ICafeRegistry.CafeRegistered(1, owner1);
        uint256 cafeId = _register(owner1);

        (address who, ICafeRegistry.CafeStatus status) = registry.getCafe(cafeId);
        assertEq(who, owner1);
        assertEq(uint8(status), uint8(ICafeRegistry.CafeStatus.Pending));
    }

    function test_registerCafe_zeroOwnerReverts() public {
        vm.expectRevert(ZeroAddress.selector);
        vm.prank(registrar);
        registry.registerCafe(address(0));
    }

    function test_registerCafe_withoutRoleReverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, registry.REGISTRAR_ROLE()
            )
        );
        vm.prank(stranger);
        registry.registerCafe(owner1);
    }

    function test_getCafe_unknownIdReverts() public {
        vm.expectRevert(abi.encodeWithSelector(CafeNotFound.selector, uint256(7)));
        registry.getCafe(7);
    }

    function test_getCafe_zeroIdReverts() public {
        _register(owner1);
        vm.expectRevert(abi.encodeWithSelector(CafeNotFound.selector, uint256(0)));
        registry.getCafe(0);
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/contracts && forge test --match-contract CafeRegistryTest`
Expected: compile error — `CafeRegistry` has no constructor argument and `ZeroAddress` / `CafeNotFound` / `cafeCount` / `getCafe` do not exist.

- [ ] **Step 3: Extend the interface**

Replace `packages/contracts/src/interfaces/ICafeRegistry.sol` with:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface ICafeRegistry {
    enum CafeStatus {
        Pending,
        Active,
        Suspended,
        Exited
    }

    enum ProductKind {
        Emission,
        Reward
    }

    event CafeRegistered(uint256 indexed cafeId, address indexed owner);
    event CafeStatusChanged(uint256 indexed cafeId, CafeStatus status);
    event ProductEligibilityChanged(
        uint256 indexed cafeId, uint256 indexed productId, ProductKind kind, bool eligible
    );
    event OperatorAuthorized(uint256 indexed cafeId, address indexed operator, bool authorized);
    event CafeOwnerProposed(uint256 indexed cafeId, address indexed proposed);
    event CafeOwnerTransferred(uint256 indexed cafeId, address indexed prev, address indexed next);

    function registerCafe(address owner) external returns (uint256 cafeId);
    function setCafeStatus(uint256 cafeId, CafeStatus status) external;
    function authorizeOperator(uint256 cafeId, address operator, bool authorized) external;
    function setEligibleProduct(uint256 cafeId, uint256 productId, ProductKind kind, bool eligible)
        external;
    function proposeOwner(uint256 cafeId, address newOwner) external;
    function acceptOwnership(uint256 cafeId) external;

    function getCafe(uint256 cafeId) external view returns (address owner, CafeStatus status);
    function isAuthorized(uint256 cafeId, address account) external view returns (bool);
    function isEligible(uint256 cafeId, uint256 productId, ProductKind kind)
        external
        view
        returns (bool);
    function isOperational(uint256 cafeId) external view returns (bool);
    function cafeCount() external view returns (uint256);
}
```

- [ ] **Step 4: Write the minimal implementation**

Replace `packages/contracts/src/CafeRegistry.sol` with:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ICafeRegistry} from "./interfaces/ICafeRegistry.sol";

error CafeNotFound(uint256 cafeId);
error InvalidStatusTransition(ICafeRegistry.CafeStatus from, ICafeRegistry.CafeStatus to);
error NotCafeOwner(uint256 cafeId, address caller);
error CafeNotConfigurable(uint256 cafeId, ICafeRegistry.CafeStatus status);
error NotPendingOwner(uint256 cafeId, address caller);
error ZeroAddress();
error NoStateChange();

/// @notice On-chain roster of member cafés: identity, status, operators, product eligibility.
/// @dev Moves no value. Consumers (PlanManager, ConsumptionLog, PunchVault) read from here.
contract CafeRegistry is ICafeRegistry, AccessControl {
    /// @notice Held by the PUNCH ops backend: onboards cafés and changes their status.
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    struct Cafe {
        address owner;
        address pendingOwner;
        CafeStatus status;
    }

    mapping(uint256 cafeId => Cafe) private _cafes;
    mapping(uint256 cafeId => mapping(address account => bool)) private _operators;
    mapping(uint256 cafeId => mapping(uint256 productId => mapping(ProductKind => bool))) private
        _eligible;

    /// @dev Ids are 1-based, so this doubles as the last assigned id.
    uint256 private _cafeCount;

    /// @param admin Multisig receiving DEFAULT_ADMIN_ROLE. REGISTRAR_ROLE is granted separately,
    /// keeping the ops key distinct from the multisig from the first block.
    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @inheritdoc ICafeRegistry
    function registerCafe(address owner)
        external
        onlyRole(REGISTRAR_ROLE)
        returns (uint256 cafeId)
    {
        if (owner == address(0)) revert ZeroAddress();
        cafeId = ++_cafeCount;
        _cafes[cafeId].owner = owner; // status defaults to Pending
        emit CafeRegistered(cafeId, owner);
    }

    /// @inheritdoc ICafeRegistry
    function getCafe(uint256 cafeId) external view returns (address owner, CafeStatus status) {
        Cafe storage cafe = _cafes[cafeId];
        if (cafe.owner == address(0)) revert CafeNotFound(cafeId);
        return (cafe.owner, cafe.status);
    }

    /// @inheritdoc ICafeRegistry
    function cafeCount() external view returns (uint256) {
        return _cafeCount;
    }
}
```

The contract will not compile yet: `ICafeRegistry` declares `setCafeStatus`, `authorizeOperator`, `setEligibleProduct`, `proposeOwner`, `acceptOwnership`, `isAuthorized`, `isEligible` and `isOperational`, which Tasks 2–5 add. To keep this task green, add temporary stubs at the bottom of the contract and delete each one in the task that implements it for real:

```solidity
    // --- Implemented in Tasks 2-5. Temporary so the contract satisfies ICafeRegistry. ---

    function setCafeStatus(uint256, CafeStatus) external {
        revert("todo: task 2");
    }

    function authorizeOperator(uint256, address, bool) external {
        revert("todo: task 3");
    }

    function isAuthorized(uint256, address) external view returns (bool) {
        return false;
    }

    function setEligibleProduct(uint256, uint256, ProductKind, bool) external {
        revert("todo: task 4");
    }

    function isEligible(uint256, uint256, ProductKind) external view returns (bool) {
        return false;
    }

    function isOperational(uint256) external view returns (bool) {
        return false;
    }

    function proposeOwner(uint256, address) external {
        revert("todo: task 5");
    }

    function acceptOwnership(uint256) external {
        revert("todo: task 5");
    }
```

These stubs are the ONLY permitted revert strings in this plan, and none survive past Task 5. Task 6 verifies that no `todo:` string remains.

- [ ] **Step 5: Update Scaffold.t.sol**

In `packages/contracts/test/Scaffold.t.sol` delete exactly four things:

1. the import line `import {CafeRegistry} from "../src/CafeRegistry.sol";`
2. the import line `import {ICafeRegistry} from "../src/interfaces/ICafeRegistry.sol";`
3. the field `CafeRegistry internal cafeRegistry;` and the `setUp` line `cafeRegistry = new CafeRegistry();`
4. the whole `test_cafeRegistry_reverts_notImplemented()` function

Everything else in the file — the other six contracts, the `NotImplemented` import, the `IConsumptionLog` import — stays untouched.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd packages/contracts && forge fmt && forge test`
Expected: PASS. `CafeRegistryTest` 8 passed; `ScaffoldTest` now 5 tests (CafeRegistry's is gone); `MockPENTest` 7 unchanged.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/CafeRegistry.sol \
        packages/contracts/src/interfaces/ICafeRegistry.sol \
        packages/contracts/test/CafeRegistry.t.sol \
        packages/contracts/test/Scaffold.t.sol
git commit -m "feat(contracts): CafeRegistry registration and roles"
```

---

### Task 2: Status state machine

**Files:**
- Modify: `packages/contracts/src/CafeRegistry.sol`
- Modify: `packages/contracts/test/CafeRegistry.t.sol`

**Interfaces:**
- Consumes: `registerCafe`, `getCafe`, `REGISTRAR_ROLE` from Task 1.
- Produces: `setCafeStatus(uint256, CafeStatus)`, `isOperational(uint256) returns (bool)`, error `InvalidStatusTransition(CafeStatus from, CafeStatus to)`, internal `_isValidTransition`. Tasks 3–5 rely on `setCafeStatus` to drive cafés into `Suspended` / `Exited`.

Valid transitions (6 of the 16 pairs):

```text
Pending   -> Active | Exited
Active    -> Suspended | Exited
Suspended -> Active | Exited
Exited    -> (nothing)
```

Same-status pairs revert `InvalidStatusTransition` too — one error covers "you cannot go there" and "you are already there".

- [ ] **Step 1: Write the failing test**

Append to `CafeRegistryTest` in `packages/contracts/test/CafeRegistry.t.sol`, and add `InvalidStatusTransition` to the import from `../src/CafeRegistry.sol`:

```solidity
    /// @dev Drives café `cafeId` to `target` through the state machine.
    function _setStatus(uint256 cafeId, ICafeRegistry.CafeStatus target) internal {
        vm.prank(registrar);
        registry.setCafeStatus(cafeId, target);
    }

    function _statusOf(uint256 cafeId) internal view returns (ICafeRegistry.CafeStatus) {
        (, ICafeRegistry.CafeStatus status) = registry.getCafe(cafeId);
        return status;
    }

    function test_setCafeStatus_pendingToActiveEmits() public {
        uint256 cafeId = _register(owner1);
        vm.expectEmit(true, false, false, true);
        emit ICafeRegistry.CafeStatusChanged(cafeId, ICafeRegistry.CafeStatus.Active);
        _setStatus(cafeId, ICafeRegistry.CafeStatus.Active);
        assertEq(uint8(_statusOf(cafeId)), uint8(ICafeRegistry.CafeStatus.Active));
    }

    function test_setCafeStatus_unknownCafeReverts() public {
        vm.expectRevert(abi.encodeWithSelector(CafeNotFound.selector, uint256(1)));
        _setStatus(1, ICafeRegistry.CafeStatus.Active);
    }

    function test_setCafeStatus_withoutRoleReverts() public {
        uint256 cafeId = _register(owner1);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, registry.REGISTRAR_ROLE()
            )
        );
        vm.prank(stranger);
        registry.setCafeStatus(cafeId, ICafeRegistry.CafeStatus.Active);
    }

    /// @dev Every (from, to) pair: the 6 valid ones succeed, the other 10 revert.
    function test_setCafeStatus_fullTransitionMatrix() public {
        for (uint8 from = 0; from < 4; from++) {
            for (uint8 to = 0; to < 4; to++) {
                ICafeRegistry.CafeStatus fromStatus = ICafeRegistry.CafeStatus(from);
                ICafeRegistry.CafeStatus toStatus = ICafeRegistry.CafeStatus(to);

                uint256 cafeId = _register(owner1);
                _driveTo(cafeId, fromStatus);

                if (_expectedValid(from, to)) {
                    _setStatus(cafeId, toStatus);
                    assertEq(uint8(_statusOf(cafeId)), to, "valid transition did not apply");
                } else {
                    vm.expectRevert(
                        abi.encodeWithSelector(
                            InvalidStatusTransition.selector, fromStatus, toStatus
                        )
                    );
                    _setStatus(cafeId, toStatus);
                }
            }
        }
    }

    /// @dev Walks a freshly registered (Pending) café to `target` using only valid hops.
    function _driveTo(uint256 cafeId, ICafeRegistry.CafeStatus target) internal {
        if (target == ICafeRegistry.CafeStatus.Pending) return;
        if (target == ICafeRegistry.CafeStatus.Exited) {
            _setStatus(cafeId, ICafeRegistry.CafeStatus.Exited);
            return;
        }
        _setStatus(cafeId, ICafeRegistry.CafeStatus.Active);
        if (target == ICafeRegistry.CafeStatus.Suspended) {
            _setStatus(cafeId, ICafeRegistry.CafeStatus.Suspended);
        }
    }

    /// @dev The state machine, written out independently of the implementation.
    function _expectedValid(uint8 from, uint8 to) internal pure returns (bool) {
        if (from == to) return false;
        if (from == 0) return to == 1 || to == 3; // Pending -> Active | Exited
        if (from == 1) return to == 2 || to == 3; // Active -> Suspended | Exited
        if (from == 2) return to == 1 || to == 3; // Suspended -> Active | Exited
        return false; // Exited is terminal
    }

    function test_isOperational_onlyActive() public {
        uint256 cafeId = _register(owner1);
        assertFalse(registry.isOperational(cafeId));

        _setStatus(cafeId, ICafeRegistry.CafeStatus.Active);
        assertTrue(registry.isOperational(cafeId));

        _setStatus(cafeId, ICafeRegistry.CafeStatus.Suspended);
        assertFalse(registry.isOperational(cafeId));

        _setStatus(cafeId, ICafeRegistry.CafeStatus.Exited);
        assertFalse(registry.isOperational(cafeId));
    }

    function test_isOperational_unknownCafeIsFalse() public view {
        assertFalse(registry.isOperational(999));
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/contracts && forge test --match-contract CafeRegistryTest`
Expected: FAIL — the stubs revert with `"todo: task 2"` instead of applying the transition.

- [ ] **Step 3: Write the implementation**

In `packages/contracts/src/CafeRegistry.sol`, delete the `setCafeStatus` and `isOperational` stubs and add:

```solidity
    /// @inheritdoc ICafeRegistry
    function setCafeStatus(uint256 cafeId, CafeStatus status) external onlyRole(REGISTRAR_ROLE) {
        Cafe storage cafe = _cafes[cafeId];
        if (cafe.owner == address(0)) revert CafeNotFound(cafeId);

        CafeStatus current = cafe.status;
        if (!_isValidTransition(current, status)) {
            revert InvalidStatusTransition(current, status);
        }

        cafe.status = status;
        emit CafeStatusChanged(cafeId, status);
    }

    /// @inheritdoc ICafeRegistry
    function isOperational(uint256 cafeId) external view returns (bool) {
        return _cafes[cafeId].status == CafeStatus.Active && _cafes[cafeId].owner != address(0);
    }

    /// @dev Exited is terminal; a café that leaves re-registers under a new id.
    function _isValidTransition(CafeStatus from, CafeStatus to) private pure returns (bool) {
        if (from == to) return false;
        if (from == CafeStatus.Exited) return false;
        if (to == CafeStatus.Exited) return true;
        if (from == CafeStatus.Pending) return to == CafeStatus.Active;
        if (from == CafeStatus.Active) return to == CafeStatus.Suspended;
        return to == CafeStatus.Active; // from == Suspended
    }
```

Note the `owner != address(0)` guard in `isOperational`: an unregistered id has status `Pending` (enum zero value) and must not read as operational for any reason.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/contracts && forge fmt && forge test`
Expected: PASS, all suites.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/CafeRegistry.sol packages/contracts/test/CafeRegistry.t.sol
git commit -m "feat(contracts): CafeRegistry status state machine"
```

---

### Task 3: Operators

**Files:**
- Modify: `packages/contracts/src/CafeRegistry.sol`
- Modify: `packages/contracts/test/CafeRegistry.t.sol`

**Interfaces:**
- Consumes: Task 1 registration, Task 2 `setCafeStatus`.
- Produces: `authorizeOperator(uint256, address, bool)`, `isAuthorized(uint256, address) returns (bool)`, errors `NotCafeOwner(uint256, address)`, `CafeNotConfigurable(uint256, CafeStatus)`, `NoStateChange()`, and the `onlyCafeOwner` / `configurable` modifiers that Tasks 4–5 reuse.

- [ ] **Step 1: Write the failing test**

Append to `CafeRegistryTest`, and add `NotCafeOwner`, `CafeNotConfigurable`, `NoStateChange` to the import from `../src/CafeRegistry.sol`:

```solidity
    function test_authorizeOperator_grantsAndEmits() public {
        uint256 cafeId = _register(owner1);
        vm.expectEmit(true, true, false, true);
        emit ICafeRegistry.OperatorAuthorized(cafeId, operator, true);
        vm.prank(owner1);
        registry.authorizeOperator(cafeId, operator, true);
        assertTrue(registry.isAuthorized(cafeId, operator));
    }

    function test_authorizeOperator_revokes() public {
        uint256 cafeId = _register(owner1);
        vm.prank(owner1);
        registry.authorizeOperator(cafeId, operator, true);
        vm.prank(owner1);
        registry.authorizeOperator(cafeId, operator, false);
        assertFalse(registry.isAuthorized(cafeId, operator));
    }

    function test_isAuthorized_ownerIsImplicitlyAuthorized() public {
        uint256 cafeId = _register(owner1);
        assertTrue(registry.isAuthorized(cafeId, owner1));
        assertFalse(registry.isAuthorized(cafeId, stranger));
    }

    function test_isAuthorized_unknownCafeIsFalse() public view {
        assertFalse(registry.isAuthorized(999, owner1));
        assertFalse(registry.isAuthorized(999, address(0)));
    }

    function test_isAuthorized_isScopedPerCafe() public {
        uint256 cafeA = _register(owner1);
        uint256 cafeB = _register(owner2);
        vm.prank(owner1);
        registry.authorizeOperator(cafeA, operator, true);
        assertTrue(registry.isAuthorized(cafeA, operator));
        assertFalse(registry.isAuthorized(cafeB, operator));
        assertFalse(registry.isAuthorized(cafeB, owner1));
    }

    function test_authorizeOperator_nonOwnerReverts() public {
        uint256 cafeId = _register(owner1);
        vm.expectRevert(abi.encodeWithSelector(NotCafeOwner.selector, cafeId, stranger));
        vm.prank(stranger);
        registry.authorizeOperator(cafeId, operator, true);
    }

    function test_authorizeOperator_otherCafeOwnerReverts() public {
        uint256 cafeA = _register(owner1);
        _register(owner2);
        vm.expectRevert(abi.encodeWithSelector(NotCafeOwner.selector, cafeA, owner2));
        vm.prank(owner2);
        registry.authorizeOperator(cafeA, operator, true);
    }

    function test_authorizeOperator_unknownCafeReverts() public {
        vm.expectRevert(abi.encodeWithSelector(CafeNotFound.selector, uint256(1)));
        vm.prank(owner1);
        registry.authorizeOperator(1, operator, true);
    }

    function test_authorizeOperator_zeroOperatorReverts() public {
        uint256 cafeId = _register(owner1);
        vm.expectRevert(ZeroAddress.selector);
        vm.prank(owner1);
        registry.authorizeOperator(cafeId, address(0), true);
    }

    function test_authorizeOperator_redundantWriteReverts() public {
        uint256 cafeId = _register(owner1);
        vm.expectRevert(NoStateChange.selector);
        vm.prank(owner1);
        registry.authorizeOperator(cafeId, operator, false);
    }

    function test_authorizeOperator_activeCafeAllowed() public {
        uint256 cafeId = _register(owner1);
        _setStatus(cafeId, ICafeRegistry.CafeStatus.Active);
        vm.prank(owner1);
        registry.authorizeOperator(cafeId, operator, true);
        assertTrue(registry.isAuthorized(cafeId, operator));
    }

    function test_authorizeOperator_suspendedCafeReverts() public {
        uint256 cafeId = _register(owner1);
        _setStatus(cafeId, ICafeRegistry.CafeStatus.Active);
        _setStatus(cafeId, ICafeRegistry.CafeStatus.Suspended);
        vm.expectRevert(
            abi.encodeWithSelector(
                CafeNotConfigurable.selector, cafeId, ICafeRegistry.CafeStatus.Suspended
            )
        );
        vm.prank(owner1);
        registry.authorizeOperator(cafeId, operator, true);
    }

    function test_authorizeOperator_exitedCafeReverts() public {
        uint256 cafeId = _register(owner1);
        _setStatus(cafeId, ICafeRegistry.CafeStatus.Exited);
        vm.expectRevert(
            abi.encodeWithSelector(
                CafeNotConfigurable.selector, cafeId, ICafeRegistry.CafeStatus.Exited
            )
        );
        vm.prank(owner1);
        registry.authorizeOperator(cafeId, operator, true);
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/contracts && forge test --match-contract CafeRegistryTest`
Expected: FAIL — `"todo: task 3"`.

- [ ] **Step 3: Write the implementation**

In `packages/contracts/src/CafeRegistry.sol`, delete the `authorizeOperator` and `isAuthorized` stubs, add the two modifiers directly after the constructor:

```solidity
    modifier onlyCafeOwner(uint256 cafeId) {
        address owner = _cafes[cafeId].owner;
        if (owner == address(0)) revert CafeNotFound(cafeId);
        if (owner != msg.sender) revert NotCafeOwner(cafeId, msg.sender);
        _;
    }

    /// @dev A café frozen for risk must not reshuffle its operators or catalogue.
    modifier configurable(uint256 cafeId) {
        CafeStatus status = _cafes[cafeId].status;
        if (status != CafeStatus.Pending && status != CafeStatus.Active) {
            revert CafeNotConfigurable(cafeId, status);
        }
        _;
    }
```

and add the two functions:

```solidity
    /// @inheritdoc ICafeRegistry
    function authorizeOperator(uint256 cafeId, address operator, bool authorized)
        external
        onlyCafeOwner(cafeId)
        configurable(cafeId)
    {
        if (operator == address(0)) revert ZeroAddress();
        if (_operators[cafeId][operator] == authorized) revert NoStateChange();

        _operators[cafeId][operator] = authorized;
        emit OperatorAuthorized(cafeId, operator, authorized);
    }

    /// @inheritdoc ICafeRegistry
    function isAuthorized(uint256 cafeId, address account) external view returns (bool) {
        if (account == address(0)) return false;
        return _cafes[cafeId].owner == account || _operators[cafeId][account];
    }
```

Modifier order matters: `onlyCafeOwner` runs first, so an unknown café reports `CafeNotFound` rather than `CafeNotConfigurable`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/contracts && forge fmt && forge test`
Expected: PASS, all suites.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/CafeRegistry.sol packages/contracts/test/CafeRegistry.t.sol
git commit -m "feat(contracts): CafeRegistry operator authorization"
```

---

### Task 4: Product eligibility

**Files:**
- Modify: `packages/contracts/src/CafeRegistry.sol`
- Modify: `packages/contracts/test/CafeRegistry.t.sol`

**Interfaces:**
- Consumes: Task 3 `onlyCafeOwner` / `configurable` modifiers, `NoStateChange`.
- Produces: `setEligibleProduct(uint256, uint256, ProductKind, bool)`, `isEligible(uint256, uint256, ProductKind) returns (bool)`.

On-chain state is a bare boolean per `(cafeId, productId, kind)`. Price, COGS and the "retail ≤ S/12" check live off-chain — see the spec's rationale for decision 2.

- [ ] **Step 1: Write the failing test**

Append to `CafeRegistryTest`:

```solidity
    function test_setEligibleProduct_approvesAndEmits() public {
        uint256 cafeId = _register(owner1);
        vm.expectEmit(true, true, false, true);
        emit ICafeRegistry.ProductEligibilityChanged(
            cafeId, 47, ICafeRegistry.ProductKind.Emission, true
        );
        vm.prank(owner1);
        registry.setEligibleProduct(cafeId, 47, ICafeRegistry.ProductKind.Emission, true);
        assertTrue(registry.isEligible(cafeId, 47, ICafeRegistry.ProductKind.Emission));
    }

    function test_setEligibleProduct_revokes() public {
        uint256 cafeId = _register(owner1);
        vm.startPrank(owner1);
        registry.setEligibleProduct(cafeId, 47, ICafeRegistry.ProductKind.Emission, true);
        registry.setEligibleProduct(cafeId, 47, ICafeRegistry.ProductKind.Emission, false);
        vm.stopPrank();
        assertFalse(registry.isEligible(cafeId, 47, ICafeRegistry.ProductKind.Emission));
    }

    /// @dev Approving a product for emission must NOT approve it as a reward.
    function test_setEligibleProduct_kindsAreIndependent() public {
        uint256 cafeId = _register(owner1);
        vm.prank(owner1);
        registry.setEligibleProduct(cafeId, 47, ICafeRegistry.ProductKind.Emission, true);
        assertTrue(registry.isEligible(cafeId, 47, ICafeRegistry.ProductKind.Emission));
        assertFalse(registry.isEligible(cafeId, 47, ICafeRegistry.ProductKind.Reward));
    }

    function test_setEligibleProduct_isScopedPerCafe() public {
        uint256 cafeA = _register(owner1);
        uint256 cafeB = _register(owner2);
        vm.prank(owner1);
        registry.setEligibleProduct(cafeA, 47, ICafeRegistry.ProductKind.Emission, true);
        assertFalse(registry.isEligible(cafeB, 47, ICafeRegistry.ProductKind.Emission));
    }

    function test_isEligible_unknownCafeIsFalse() public view {
        assertFalse(registry.isEligible(999, 47, ICafeRegistry.ProductKind.Emission));
    }

    function test_setEligibleProduct_nonOwnerReverts() public {
        uint256 cafeId = _register(owner1);
        vm.expectRevert(abi.encodeWithSelector(NotCafeOwner.selector, cafeId, stranger));
        vm.prank(stranger);
        registry.setEligibleProduct(cafeId, 47, ICafeRegistry.ProductKind.Emission, true);
    }

    function test_setEligibleProduct_unknownCafeReverts() public {
        vm.expectRevert(abi.encodeWithSelector(CafeNotFound.selector, uint256(1)));
        vm.prank(owner1);
        registry.setEligibleProduct(1, 47, ICafeRegistry.ProductKind.Emission, true);
    }

    function test_setEligibleProduct_redundantWriteReverts() public {
        uint256 cafeId = _register(owner1);
        vm.expectRevert(NoStateChange.selector);
        vm.prank(owner1);
        registry.setEligibleProduct(cafeId, 47, ICafeRegistry.ProductKind.Emission, false);
    }

    function test_setEligibleProduct_suspendedCafeReverts() public {
        uint256 cafeId = _register(owner1);
        _setStatus(cafeId, ICafeRegistry.CafeStatus.Active);
        _setStatus(cafeId, ICafeRegistry.CafeStatus.Suspended);
        vm.expectRevert(
            abi.encodeWithSelector(
                CafeNotConfigurable.selector, cafeId, ICafeRegistry.CafeStatus.Suspended
            )
        );
        vm.prank(owner1);
        registry.setEligibleProduct(cafeId, 47, ICafeRegistry.ProductKind.Emission, true);
    }

    function test_setEligibleProduct_exitedCafeReverts() public {
        uint256 cafeId = _register(owner1);
        _setStatus(cafeId, ICafeRegistry.CafeStatus.Exited);
        vm.expectRevert(
            abi.encodeWithSelector(
                CafeNotConfigurable.selector, cafeId, ICafeRegistry.CafeStatus.Exited
            )
        );
        vm.prank(owner1);
        registry.setEligibleProduct(cafeId, 47, ICafeRegistry.ProductKind.Emission, true);
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/contracts && forge test --match-contract CafeRegistryTest`
Expected: FAIL — `"todo: task 4"`.

- [ ] **Step 3: Write the implementation**

In `packages/contracts/src/CafeRegistry.sol`, delete the `setEligibleProduct` and `isEligible` stubs and add:

```solidity
    /// @inheritdoc ICafeRegistry
    /// @dev Records PUNCH's approval decision only. Retail price and COGS stay off-chain;
    /// no contract reads a price to settle (payout and reserve are fixed).
    function setEligibleProduct(uint256 cafeId, uint256 productId, ProductKind kind, bool eligible)
        external
        onlyCafeOwner(cafeId)
        configurable(cafeId)
    {
        if (_eligible[cafeId][productId][kind] == eligible) revert NoStateChange();

        _eligible[cafeId][productId][kind] = eligible;
        emit ProductEligibilityChanged(cafeId, productId, kind, eligible);
    }

    /// @inheritdoc ICafeRegistry
    function isEligible(uint256 cafeId, uint256 productId, ProductKind kind)
        external
        view
        returns (bool)
    {
        return _eligible[cafeId][productId][kind];
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/contracts && forge fmt && forge test`
Expected: PASS, all suites.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/CafeRegistry.sol packages/contracts/test/CafeRegistry.t.sol
git commit -m "feat(contracts): CafeRegistry product eligibility"
```

---

### Task 5: Two-step ownership transfer

**Files:**
- Modify: `packages/contracts/src/CafeRegistry.sol`
- Modify: `packages/contracts/test/CafeRegistry.t.sol`

**Interfaces:**
- Consumes: `onlyCafeOwner`, `Cafe.pendingOwner` (already in the struct from Task 1).
- Produces: `proposeOwner(uint256, address)`, `acceptOwnership(uint256)`, error `NotPendingOwner(uint256, address)`. This is the last stub removed — after this task the contract has no `todo:` strings left.

Operators and product eligibility are keyed by `cafeId`, not by owner, so they survive a transfer by construction. The tests assert that explicitly.

- [ ] **Step 1: Write the failing test**

Append to `CafeRegistryTest`, and add `NotPendingOwner` to the import from `../src/CafeRegistry.sol`:

```solidity
    function test_proposeOwner_emitsAndDoesNotTransferYet() public {
        uint256 cafeId = _register(owner1);
        vm.expectEmit(true, true, false, false);
        emit ICafeRegistry.CafeOwnerProposed(cafeId, owner2);
        vm.prank(owner1);
        registry.proposeOwner(cafeId, owner2);

        (address who,) = registry.getCafe(cafeId);
        assertEq(who, owner1, "ownership moved before acceptance");
    }

    function test_acceptOwnership_transfersAndEmits() public {
        uint256 cafeId = _register(owner1);
        vm.prank(owner1);
        registry.proposeOwner(cafeId, owner2);

        vm.expectEmit(true, true, true, false);
        emit ICafeRegistry.CafeOwnerTransferred(cafeId, owner1, owner2);
        vm.prank(owner2);
        registry.acceptOwnership(cafeId);

        (address who,) = registry.getCafe(cafeId);
        assertEq(who, owner2);
        assertTrue(registry.isAuthorized(cafeId, owner2));
        assertFalse(registry.isAuthorized(cafeId, owner1));
    }

    function test_acceptOwnership_oldOwnerLosesWriteAccess() public {
        uint256 cafeId = _register(owner1);
        vm.prank(owner1);
        registry.proposeOwner(cafeId, owner2);
        vm.prank(owner2);
        registry.acceptOwnership(cafeId);

        vm.expectRevert(abi.encodeWithSelector(NotCafeOwner.selector, cafeId, owner1));
        vm.prank(owner1);
        registry.authorizeOperator(cafeId, operator, true);
    }

    function test_acceptOwnership_operatorsAndProductsSurvive() public {
        uint256 cafeId = _register(owner1);
        vm.startPrank(owner1);
        registry.authorizeOperator(cafeId, operator, true);
        registry.setEligibleProduct(cafeId, 47, ICafeRegistry.ProductKind.Emission, true);
        registry.proposeOwner(cafeId, owner2);
        vm.stopPrank();

        vm.prank(owner2);
        registry.acceptOwnership(cafeId);

        assertTrue(registry.isAuthorized(cafeId, operator));
        assertTrue(registry.isEligible(cafeId, 47, ICafeRegistry.ProductKind.Emission));
    }

    function test_proposeOwner_secondProposalInvalidatesFirst() public {
        uint256 cafeId = _register(owner1);
        vm.startPrank(owner1);
        registry.proposeOwner(cafeId, owner2);
        registry.proposeOwner(cafeId, stranger);
        vm.stopPrank();

        vm.expectRevert(abi.encodeWithSelector(NotPendingOwner.selector, cafeId, owner2));
        vm.prank(owner2);
        registry.acceptOwnership(cafeId);

        vm.prank(stranger);
        registry.acceptOwnership(cafeId);
        (address who,) = registry.getCafe(cafeId);
        assertEq(who, stranger);
    }

    function test_acceptOwnership_cannotBeReplayed() public {
        uint256 cafeId = _register(owner1);
        vm.prank(owner1);
        registry.proposeOwner(cafeId, owner2);
        vm.prank(owner2);
        registry.acceptOwnership(cafeId);

        vm.expectRevert(abi.encodeWithSelector(NotPendingOwner.selector, cafeId, owner2));
        vm.prank(owner2);
        registry.acceptOwnership(cafeId);
    }

    function test_acceptOwnership_byNonProposedReverts() public {
        uint256 cafeId = _register(owner1);
        vm.prank(owner1);
        registry.proposeOwner(cafeId, owner2);

        vm.expectRevert(abi.encodeWithSelector(NotPendingOwner.selector, cafeId, stranger));
        vm.prank(stranger);
        registry.acceptOwnership(cafeId);
    }

    function test_acceptOwnership_unknownCafeReverts() public {
        vm.expectRevert(abi.encodeWithSelector(CafeNotFound.selector, uint256(1)));
        vm.prank(owner2);
        registry.acceptOwnership(1);
    }

    function test_proposeOwner_nonOwnerReverts() public {
        uint256 cafeId = _register(owner1);
        vm.expectRevert(abi.encodeWithSelector(NotCafeOwner.selector, cafeId, stranger));
        vm.prank(stranger);
        registry.proposeOwner(cafeId, owner2);
    }

    function test_proposeOwner_zeroAddressReverts() public {
        uint256 cafeId = _register(owner1);
        vm.expectRevert(ZeroAddress.selector);
        vm.prank(owner1);
        registry.proposeOwner(cafeId, address(0));
    }

    function test_proposeOwner_selfReverts() public {
        uint256 cafeId = _register(owner1);
        vm.expectRevert(NoStateChange.selector);
        vm.prank(owner1);
        registry.proposeOwner(cafeId, owner1);
    }

    function test_proposeOwner_exitedCafeReverts() public {
        uint256 cafeId = _register(owner1);
        _setStatus(cafeId, ICafeRegistry.CafeStatus.Exited);
        vm.expectRevert(
            abi.encodeWithSelector(
                CafeNotConfigurable.selector, cafeId, ICafeRegistry.CafeStatus.Exited
            )
        );
        vm.prank(owner1);
        registry.proposeOwner(cafeId, owner2);
    }

    /// @dev Unlike operator/product writes, a Suspended café MAY still hand over ownership —
    /// selling or repairing a suspended café is exactly when a transfer is needed.
    function test_proposeOwner_suspendedCafeAllowed() public {
        uint256 cafeId = _register(owner1);
        _setStatus(cafeId, ICafeRegistry.CafeStatus.Active);
        _setStatus(cafeId, ICafeRegistry.CafeStatus.Suspended);
        vm.prank(owner1);
        registry.proposeOwner(cafeId, owner2);
        vm.prank(owner2);
        registry.acceptOwnership(cafeId);
        (address who,) = registry.getCafe(cafeId);
        assertEq(who, owner2);
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/contracts && forge test --match-contract CafeRegistryTest`
Expected: FAIL — `"todo: task 5"`.

- [ ] **Step 3: Write the implementation**

In `packages/contracts/src/CafeRegistry.sol`, delete the `proposeOwner` and `acceptOwnership` stubs (the stub block is now empty — remove the section comment too) and add:

```solidity
    /// @inheritdoc ICafeRegistry
    /// @dev Two-step so a café cannot be sent to an address that cannot claim it.
    /// Allowed while Suspended: selling or repairing a suspended café needs this.
    function proposeOwner(uint256 cafeId, address newOwner) external onlyCafeOwner(cafeId) {
        Cafe storage cafe = _cafes[cafeId];
        if (cafe.status == CafeStatus.Exited) {
            revert CafeNotConfigurable(cafeId, CafeStatus.Exited);
        }
        if (newOwner == address(0)) revert ZeroAddress();
        if (newOwner == cafe.owner) revert NoStateChange();

        cafe.pendingOwner = newOwner;
        emit CafeOwnerProposed(cafeId, newOwner);
    }

    /// @inheritdoc ICafeRegistry
    /// @dev Operators and product eligibility are keyed by cafeId, so they survive the transfer.
    function acceptOwnership(uint256 cafeId) external {
        Cafe storage cafe = _cafes[cafeId];
        if (cafe.owner == address(0)) revert CafeNotFound(cafeId);
        if (cafe.pendingOwner != msg.sender) revert NotPendingOwner(cafeId, msg.sender);

        address previous = cafe.owner;
        cafe.owner = msg.sender;
        cafe.pendingOwner = address(0);
        emit CafeOwnerTransferred(cafeId, previous, msg.sender);
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/contracts && forge fmt && forge test`
Expected: PASS, all suites.

- [ ] **Step 5: Verify no stubs remain**

Run: `cd packages/contracts && grep -rn "todo: task" src/ || echo "no stubs left"`
Expected: `no stubs left`.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/CafeRegistry.sol packages/contracts/test/CafeRegistry.t.sol
git commit -m "feat(contracts): CafeRegistry two-step ownership transfer"
```

---

### Task 6: Fuzz and invariant tests

**Files:**
- Modify: `packages/contracts/test/CafeRegistry.t.sol`
- Create: `packages/contracts/test/CafeRegistryInvariant.t.sol`

**Interfaces:**
- Consumes: the complete `CafeRegistry` from Tasks 1–5.
- Produces: no production code. §20 of the master spec requires invariant/fuzz tests.

The invariant lives in its own file because forge's invariant runner targets contracts registered in `setUp`; mixing a `targetContract` handler into the unit-test contract would subject every unit test to the fuzzing harness.

- [ ] **Step 1: Write the fuzz tests**

Append to `CafeRegistryTest` in `packages/contracts/test/CafeRegistry.t.sol`:

```solidity
    function testFuzz_registerCafe_idsAreUniqueAndCounted(address a, address b) public {
        vm.assume(a != address(0) && b != address(0));

        uint256 first = _register(a);
        uint256 second = _register(b);

        assertEq(first, 1);
        assertEq(second, 2);
        assertEq(registry.cafeCount(), 2);

        (address ownerA,) = registry.getCafe(first);
        (address ownerB,) = registry.getCafe(second);
        assertEq(ownerA, a);
        assertEq(ownerB, b);
    }

    function testFuzz_isAuthorized_falseForUnrelatedAccounts(address who) public {
        uint256 cafeId = _register(owner1);
        vm.prank(owner1);
        registry.authorizeOperator(cafeId, operator, true);

        vm.assume(who != owner1 && who != operator);
        assertFalse(registry.isAuthorized(cafeId, who));
    }

    function testFuzz_setEligibleProduct_reflectsLastWrite(uint256 productId, bool eligible)
        public
    {
        uint256 cafeId = _register(owner1);

        if (eligible) {
            vm.prank(owner1);
            registry.setEligibleProduct(cafeId, productId, ICafeRegistry.ProductKind.Emission, true);
        }

        assertEq(
            registry.isEligible(cafeId, productId, ICafeRegistry.ProductKind.Emission), eligible
        );
        assertFalse(registry.isEligible(cafeId, productId, ICafeRegistry.ProductKind.Reward));
    }
```

- [ ] **Step 2: Write the invariant test**

Create `packages/contracts/test/CafeRegistryInvariant.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {CafeRegistry} from "../src/CafeRegistry.sol";
import {ICafeRegistry} from "../src/interfaces/ICafeRegistry.sol";

/// @dev Hammers setCafeStatus with arbitrary targets, swallowing reverts, and records
/// whether the café was ever driven to Exited.
contract StatusHandler is Test {
    CafeRegistry public registry;
    uint256 public cafeId;
    bool public everExited;

    constructor(CafeRegistry registry_, uint256 cafeId_) {
        registry = registry_;
        cafeId = cafeId_;
    }

    function poke(uint8 rawStatus) external {
        ICafeRegistry.CafeStatus target =
            ICafeRegistry.CafeStatus(uint8(bound(uint256(rawStatus), 0, 3)));
        try registry.setCafeStatus(cafeId, target) {
            if (target == ICafeRegistry.CafeStatus.Exited) {
                everExited = true;
            }
        } catch {}
    }
}

contract CafeRegistryInvariantTest is Test {
    CafeRegistry internal registry;
    StatusHandler internal handler;

    address internal admin = makeAddr("admin");
    address internal cafeOwner = makeAddr("cafeOwner");

    function setUp() public {
        registry = new CafeRegistry(admin);

        vm.startPrank(admin);
        registry.grantRole(registry.REGISTRAR_ROLE(), address(this));
        vm.stopPrank();

        uint256 cafeId = registry.registerCafe(cafeOwner);
        handler = new StatusHandler(registry, cafeId);

        vm.prank(admin);
        registry.grantRole(registry.REGISTRAR_ROLE(), address(handler));

        targetContract(address(handler));
    }

    /// @notice Invariant: once a café reaches Exited it never leaves (spec decision 3).
    function invariant_exitedIsTerminal() public view {
        if (!handler.everExited()) return;
        (, ICafeRegistry.CafeStatus status) = registry.getCafe(handler.cafeId());
        assertEq(
            uint8(status),
            uint8(ICafeRegistry.CafeStatus.Exited),
            "a café left the Exited state"
        );
    }
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cd packages/contracts && forge fmt && forge test`
Expected: PASS. `CafeRegistryInvariantTest` reports one invariant run with calls executed and zero failures.

Sanity-check that the invariant can actually fail: temporarily change `_isValidTransition` in `CafeRegistry.sol` so that `from == CafeStatus.Exited` returns `true` instead of `false`, re-run `forge test --match-contract CafeRegistryInvariantTest`, and confirm it FAILS with "a café left the Exited state". Then revert that change and re-run to confirm it passes again. An invariant that cannot fail is not a test.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/test/CafeRegistry.t.sol packages/contracts/test/CafeRegistryInvariant.t.sol
git commit -m "test(contracts): CafeRegistry fuzz and terminal-exit invariant"
```

---

### Task 7: Update master spec §16

**Files:**
- Modify: `docs/superpowers/specs/2026-08-07-punch-master-spec.md` (§16 `CafeRegistry` subsection, around line 569)

**Interfaces:**
- Consumes: the shipped `ICafeRegistry`.
- Produces: nothing in code. Keeps the master spec from describing an interface that no longer exists.

- [ ] **Step 1: Replace the `CafeRegistry` subsection of §16**

The current subsection lists four operations and three events. Replace everything between the `### \`CafeRegistry\`` heading and the `### \`PlanManager\`` heading with:

```markdown
### `CafeRegistry`

Responsabilidad:

- Identidad on-chain de café.
- Estado `pending | active | suspended | exited`, con transiciones validadas y `exited` terminal.
- Cuentas autorizadas; el owner queda autorizado implícitamente.
- Productos de emisión/reward: solo el bit de aprobación. Precio, COGS y el tope de retail S/12 se verifican fuera de cadena (§07); ningún contrato lee un precio para liquidar.
- Traspaso de titularidad en dos pasos.

No mueve valor: ni PUNCH, ni reserva, ni PEN.

Roles:

- `DEFAULT_ADMIN_ROLE` — multisig PUNCH; otorga y revoca roles.
- `REGISTRAR_ROLE` — backend de operación PUNCH; `registerCafe` y `setCafeStatus`.
- Escrituras del café (`authorizeOperator`, `setEligibleProduct`, `proposeOwner`) no usan rol: se validan contra la titularidad del `cafeId`.

Sin `Pausable`: el freno granular es `setCafeStatus(id, Suspended)` y una llave de registrar comprometida se responde con `revokeRole`. La pausa vive en los contratos que mueven valor.

Operaciones:

- `registerCafe`
- `setCafeStatus`
- `authorizeOperator`
- `setEligibleProduct`
- `proposeOwner`
- `acceptOwnership`

Lecturas:

- `getCafe`
- `isAuthorized`
- `isEligible`
- `isOperational`
- `cafeCount`

Eventos:

- `CafeRegistered`
- `CafeStatusChanged`
- `ProductEligibilityChanged`
- `OperatorAuthorized`
- `CafeOwnerProposed`
- `CafeOwnerTransferred`

`setCafeStatus(id, exited)` no toca reserva ni balances; esas obligaciones (§02.8, §21) son de `PunchVault` y `PlanManager`.
```

- [ ] **Step 2: Verify nothing else in §16 changed**

Run: `git diff docs/superpowers/specs/2026-08-07-punch-master-spec.md`
Expected: the diff touches only the `CafeRegistry` subsection. The `PlanManager`, `ConsumptionLog`, `PunchVault`, `NetworkFund`, `CampaignEscrow`, `MockPEN` and `PUNCH Treasury` subsections are untouched.

- [ ] **Step 3: Run the full suite one last time**

Run: `cd packages/contracts && forge test`
Expected: PASS, zero failures.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-08-07-punch-master-spec.md
git commit -m "docs: sync master spec §16 with shipped CafeRegistry"
```

---

## Done when

- `forge test` is green: `CafeRegistryTest`, `CafeRegistryInvariantTest`, `MockPENTest`, and the reduced `ScaffoldTest`.
- No `todo:` string and no revert string anywhere in `packages/contracts/src/`.
- `ScaffoldTest` no longer references `CafeRegistry`.
- Master spec §16 matches the shipped interface.
- Nothing outside `CafeRegistry.sol`, `ICafeRegistry.sol`, the two new test files, `Scaffold.t.sol`, and the master spec was modified.
