# PlanManager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `PlanManager` — plan/pack purchase with atomic mPEN split, emission-credit ledger, unallocated-reserve custody, and credit consumption gated to ConsumptionLog — per `docs/superpowers/specs/2026-08-07-planmanager-design.md`.

**Architecture:** `PlanManager` implements the frozen `IPlanManager` interface plus `Ownable`. It charges in mPEN via `transferFrom`, forwards the fund/treasury shares in the same transaction, and keeps the reserve share (S/0.30 × 100 credits) in-contract as *unallocated reserve*. `consumeCredit` (callable only by the address set via `setConsumptionLog`) decrements one credit and forwards S/0.30 to the PunchVault address. Emission itself is orchestrated by ConsumptionLog — this contract never calls `vault.issue`.

**Tech Stack:** Solidity ^0.8.30, Foundry (forge), OpenZeppelin (Ownable, IERC20, SafeERC20), existing `CafeRegistry` and `MockPEN` as real test dependencies.

## Global Constraints

- Solidity `pragma solidity ^0.8.30;` — matches `foundry.toml` `solc_version = "0.8.30"`.
- Frozen interface `src/interfaces/IPlanManager.sol` must not change; ops functions (`setConsumptionLog`) live only on the contract.
- mPEN has 6 decimals. Exact economic constants (spec §09): `PLAN_PRICE = 49e6`, `PACK_PRICE = 40e6`, `CREDITS_PER_PURCHASE = 100`, `RESERVE_PER_CREDIT = 300_000`, plan split 5e6 fund / 14e6 treasury / 30e6 reserve, pack split 5e6 fund / 5e6 treasury / 30e6 reserve.
- Split and credit accrual must occur in one transaction (spec §17).
- Custom errors are free-standing at file level (repo convention, see `CafeRegistry.sol` / `MockPEN.sol`).
- Contract invariants (spec): (1) `unallocatedReserve[cafeId] == credits[cafeId] × RESERVE_PER_CREDIT`; (2) `pen.balanceOf(planManager) ≥ Σ unallocatedReserve`.
- Foundry footgun: a view call after `vm.prank` consumes the prank — cache view results (e.g. `REGISTRAR_ROLE()`) BEFORE pranking, or use `vm.startPrank`.
- All commands run from `packages/contracts/`. Run tests with `forge test`.
- Only this plan's files may be touched, plus removal of exactly one stub test block from `Scaffold.t.sol`. Never touch `ConsumptionLog.sol`, `PunchVault.sol`, `Deploy.s.sol`, or other sub-projects' files.

---

### Task 1: PlanManager contract + unit tests

**Files:**
- Modify: `packages/contracts/src/PlanManager.sol` (replace stub entirely)
- Create: `packages/contracts/test/PlanManager.t.sol`
- Modify: `packages/contracts/test/Scaffold.t.sol` (remove PlanManager stub pieces — required for compilation, the stub constructs `new PlanManager()` with no args)

**Interfaces:**
- Consumes: `ICafeRegistry` (`isAuthorized`, `isOperational`, `getCafe`), `IPlanManager` (frozen), `MockPEN` (ERC20 6 decimals + `faucet`), OpenZeppelin `Ownable`, `IERC20`, `SafeERC20`.
- Produces: `PlanManager` with constructor `(IERC20 pen_, ICafeRegistry registry_, address vault_, address networkFund_, address treasury_)`, public getters `credits(uint256)`, `unallocatedReserve(uint256)`, `planActive(uint256)`, `consumptionLog()`, constants listed in Global Constraints, and `setConsumptionLog(address) onlyOwner`. Tasks 2-3 rely on these exact names.

- [ ] **Step 1: Remove the PlanManager stub from `Scaffold.t.sol`**

In `packages/contracts/test/Scaffold.t.sol` delete exactly:
- the import line `import {PlanManager} from "../src/PlanManager.sol";`
- the field `PlanManager internal planManager;`
- the setUp line `planManager = new PlanManager();`
- the whole `test_planManager_reverts_notImplemented` function

Leave every other stub test untouched.

- [ ] **Step 2: Write the failing tests**

Create `packages/contracts/test/PlanManager.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    PlanManager,
    ZeroAddress,
    NotAuthorizedForCafe,
    CafeNotOperational,
    PlanNotActive,
    PlanStillActive,
    NoCredits,
    NotConsumptionLog,
    NotCafeOwner,
    NothingToWithdraw
} from "../src/PlanManager.sol";
import {CafeRegistry} from "../src/CafeRegistry.sol";
import {MockPEN} from "../src/MockPEN.sol";
import {ICafeRegistry} from "../src/interfaces/ICafeRegistry.sol";
import {IPlanManager} from "../src/interfaces/IPlanManager.sol";

contract PlanManagerTest is Test {
    MockPEN internal pen;
    CafeRegistry internal registry;
    PlanManager internal manager;

    address internal admin = makeAddr("admin");
    address internal registrar = makeAddr("registrar");
    address internal cafeOwner = makeAddr("cafeOwner");
    address internal operator = makeAddr("operator");
    address internal vault = makeAddr("vault");
    address internal networkFund = makeAddr("networkFund");
    address internal treasury = makeAddr("treasury");
    address internal consumptionLog = makeAddr("consumptionLog");
    address internal stranger = makeAddr("stranger");

    uint256 internal cafeId;

    function setUp() public {
        pen = new MockPEN();
        registry = new CafeRegistry(admin);

        // Cache the role before pranking: the view call would consume a vm.prank.
        bytes32 registrarRole = registry.REGISTRAR_ROLE();
        vm.prank(admin);
        registry.grantRole(registrarRole, registrar);

        vm.startPrank(registrar);
        cafeId = registry.registerCafe(cafeOwner);
        registry.setCafeStatus(cafeId, ICafeRegistry.CafeStatus.Active);
        vm.stopPrank();

        vm.prank(cafeOwner);
        registry.authorizeOperator(cafeId, operator, true);

        manager = new PlanManager(IERC20(address(pen)), registry, vault, networkFund, treasury);
        manager.setConsumptionLog(consumptionLog);

        vm.startPrank(cafeOwner);
        pen.faucet(1_000e6);
        pen.approve(address(manager), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(operator);
        pen.faucet(1_000e6);
        pen.approve(address(manager), type(uint256).max);
        vm.stopPrank();
    }

    function _subscribe() internal {
        vm.prank(cafeOwner);
        manager.subscribe(cafeId);
    }

    function test_constructor_zeroAddressReverts() public {
        vm.expectRevert(ZeroAddress.selector);
        new PlanManager(IERC20(address(pen)), registry, address(0), networkFund, treasury);
    }

    function test_subscribe_splitsActivatesAndEmits() public {
        vm.expectEmit(true, false, false, true);
        emit IPlanManager.PlanActivated(cafeId);
        _subscribe();

        assertEq(pen.balanceOf(networkFund), 5e6);
        assertEq(pen.balanceOf(treasury), 14e6);
        assertEq(pen.balanceOf(address(manager)), 30e6);
        assertEq(manager.credits(cafeId), 100);
        assertEq(manager.unallocatedReserve(cafeId), 30e6);
        assertTrue(manager.planActive(cafeId));
    }

    function test_subscribe_operatorAllowed() public {
        vm.prank(operator);
        manager.subscribe(cafeId);
        assertTrue(manager.planActive(cafeId));
    }

    function test_subscribe_unauthorizedReverts() public {
        vm.expectRevert(abi.encodeWithSelector(NotAuthorizedForCafe.selector, cafeId, stranger));
        vm.prank(stranger);
        manager.subscribe(cafeId);
    }

    function test_subscribe_notOperationalReverts() public {
        vm.prank(registrar);
        registry.setCafeStatus(cafeId, ICafeRegistry.CafeStatus.Suspended);
        vm.expectRevert(abi.encodeWithSelector(CafeNotOperational.selector, cafeId));
        vm.prank(cafeOwner);
        manager.subscribe(cafeId);
    }

    function test_buyPack_splitsAndStacks() public {
        _subscribe();
        vm.expectEmit(true, false, false, true);
        emit IPlanManager.PackPurchased(cafeId);
        vm.prank(cafeOwner);
        manager.buyPack(cafeId);

        assertEq(pen.balanceOf(networkFund), 10e6);
        assertEq(pen.balanceOf(treasury), 19e6);
        assertEq(pen.balanceOf(address(manager)), 60e6);
        assertEq(manager.credits(cafeId), 200);
        assertEq(manager.unallocatedReserve(cafeId), 60e6);
    }

    function test_buyPack_withoutPlanReverts() public {
        vm.expectRevert(abi.encodeWithSelector(PlanNotActive.selector, cafeId));
        vm.prank(cafeOwner);
        manager.buyPack(cafeId);
    }

    function test_consumeCredit_decrementsAndFundsVault() public {
        _subscribe();
        vm.expectEmit(true, false, false, true);
        emit IPlanManager.EmissionCreditConsumed(cafeId);
        vm.prank(consumptionLog);
        manager.consumeCredit(cafeId);

        assertEq(manager.credits(cafeId), 99);
        assertEq(manager.unallocatedReserve(cafeId), 30e6 - 300_000);
        assertEq(pen.balanceOf(vault), 300_000);
        assertEq(pen.balanceOf(address(manager)), 30e6 - 300_000);
    }

    function test_consumeCredit_wrongCallerReverts() public {
        _subscribe();
        vm.expectRevert(abi.encodeWithSelector(NotConsumptionLog.selector, stranger));
        vm.prank(stranger);
        manager.consumeCredit(cafeId);
    }

    function test_consumeCredit_planInactiveReverts() public {
        _subscribe();
        vm.prank(cafeOwner);
        manager.cancel(cafeId);
        vm.expectRevert(abi.encodeWithSelector(PlanNotActive.selector, cafeId));
        vm.prank(consumptionLog);
        manager.consumeCredit(cafeId);
    }

    function test_consumeCredit_suspendedCafeReverts() public {
        _subscribe();
        vm.prank(registrar);
        registry.setCafeStatus(cafeId, ICafeRegistry.CafeStatus.Suspended);
        vm.expectRevert(abi.encodeWithSelector(CafeNotOperational.selector, cafeId));
        vm.prank(consumptionLog);
        manager.consumeCredit(cafeId);
    }

    function test_consumeCredit_noCreditsReverts() public {
        _subscribe();
        vm.startPrank(consumptionLog);
        for (uint256 i = 0; i < 100; i++) {
            manager.consumeCredit(cafeId);
        }
        vm.expectRevert(abi.encodeWithSelector(NoCredits.selector, cafeId));
        manager.consumeCredit(cafeId);
        vm.stopPrank();
    }

    function test_cancel_onlyCafeOwner() public {
        _subscribe();
        vm.expectRevert(abi.encodeWithSelector(NotCafeOwner.selector, cafeId, operator));
        vm.prank(operator);
        manager.cancel(cafeId);

        vm.expectEmit(true, false, false, true);
        emit IPlanManager.PlanCancelled(cafeId);
        vm.prank(cafeOwner);
        manager.cancel(cafeId);
        assertFalse(manager.planActive(cafeId));

        vm.expectRevert(abi.encodeWithSelector(PlanNotActive.selector, cafeId));
        vm.prank(cafeOwner);
        manager.buyPack(cafeId);
    }

    function test_cancel_withoutPlanReverts() public {
        vm.expectRevert(abi.encodeWithSelector(PlanNotActive.selector, cafeId));
        vm.prank(cafeOwner);
        manager.cancel(cafeId);
    }

    function test_withdraw_paysAndZeroes() public {
        _subscribe();
        vm.prank(consumptionLog);
        manager.consumeCredit(cafeId);
        vm.prank(cafeOwner);
        manager.cancel(cafeId);

        uint256 expected = 30e6 - 300_000;
        uint256 balanceBefore = pen.balanceOf(cafeOwner);
        vm.expectEmit(true, false, false, true);
        emit IPlanManager.UnusedReserveWithdrawn(cafeId, expected);
        vm.prank(cafeOwner);
        manager.withdrawUnusedReserve(cafeId);

        assertEq(pen.balanceOf(cafeOwner), balanceBefore + expected);
        assertEq(manager.credits(cafeId), 0);
        assertEq(manager.unallocatedReserve(cafeId), 0);
        assertEq(pen.balanceOf(address(manager)), 0);
    }

    function test_withdraw_planActiveReverts() public {
        _subscribe();
        vm.expectRevert(abi.encodeWithSelector(PlanStillActive.selector, cafeId));
        vm.prank(cafeOwner);
        manager.withdrawUnusedReserve(cafeId);
    }

    function test_withdraw_nothingReverts() public {
        vm.expectRevert(abi.encodeWithSelector(NothingToWithdraw.selector, cafeId));
        vm.prank(cafeOwner);
        manager.withdrawUnusedReserve(cafeId);
    }

    function test_withdraw_afterExitedCafe() public {
        _subscribe();
        vm.prank(registrar);
        registry.setCafeStatus(cafeId, ICafeRegistry.CafeStatus.Exited);

        vm.prank(cafeOwner);
        manager.cancel(cafeId);
        vm.prank(cafeOwner);
        manager.withdrawUnusedReserve(cafeId);
        assertEq(pen.balanceOf(cafeOwner), 1_000e6 - 49e6 + 30e6);
    }

    function test_resubscribe_afterCancelStacks() public {
        _subscribe();
        vm.prank(consumptionLog);
        manager.consumeCredit(cafeId);
        vm.prank(cafeOwner);
        manager.cancel(cafeId);

        _subscribe();
        assertTrue(manager.planActive(cafeId));
        assertEq(manager.credits(cafeId), 199);
        assertEq(manager.unallocatedReserve(cafeId), 199 * 300_000);
    }

    function test_setConsumptionLog_onlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        manager.setConsumptionLog(stranger);

        manager.setConsumptionLog(address(0));
        vm.expectRevert(abi.encodeWithSelector(NotConsumptionLog.selector, consumptionLog));
        vm.prank(consumptionLog);
        manager.consumeCredit(cafeId);
    }
}
```

- [ ] **Step 3: Run tests to verify they fail to compile**

Run from `packages/contracts/`: `forge test --match-contract PlanManagerTest`
Expected: compilation failure (stub `PlanManager` has no constructor args, no `credits`, no errors).

- [ ] **Step 4: Implement PlanManager**

Replace `packages/contracts/src/PlanManager.sol` entirely with:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPlanManager} from "./interfaces/IPlanManager.sol";
import {ICafeRegistry} from "./interfaces/ICafeRegistry.sol";

error ZeroAddress();
error NotAuthorizedForCafe(uint256 cafeId, address account);
error CafeNotOperational(uint256 cafeId);
error PlanNotActive(uint256 cafeId);
error PlanStillActive(uint256 cafeId);
error NoCredits(uint256 cafeId);
error NotConsumptionLog(address caller);
error NotCafeOwner(uint256 cafeId, address account);
error NothingToWithdraw(uint256 cafeId);

/// @notice Runs each café's plan: charges in mPEN, splits revenue, tracks emission
/// credits, and custodies the unallocated reserve backing them (S/0.30 per credit).
/// @dev Emission is orchestrated by ConsumptionLog: it calls `consumeCredit` here and
/// then `PunchVault.issue`. This contract never issues PUNCH itself. The reserve share
/// of each purchase stays here as unallocated reserve and moves to the vault credit by
/// credit on emission, so `withdrawUnusedReserve` can never touch reserve backing live
/// PUNCH (spec invariant 9).
contract PlanManager is IPlanManager, Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant PLAN_PRICE = 49e6;
    uint256 public constant PACK_PRICE = 40e6;
    uint256 public constant CREDITS_PER_PURCHASE = 100;
    uint256 public constant RESERVE_PER_CREDIT = 300_000; // S/0.30
    uint256 public constant PLAN_FUND_SHARE = 5e6;
    uint256 public constant PLAN_TREASURY_SHARE = 14e6;
    uint256 public constant PACK_FUND_SHARE = 5e6;
    uint256 public constant PACK_TREASURY_SHARE = 5e6;

    IERC20 public immutable pen;
    ICafeRegistry public immutable registry;
    address public immutable vault;
    address public immutable networkFund;
    address public immutable treasury;

    /// @notice Only address allowed to call `consumeCredit`; the ConsumptionLog contract in production.
    address public consumptionLog;

    mapping(uint256 cafeId => uint256) public credits;
    mapping(uint256 cafeId => uint256) public unallocatedReserve;
    mapping(uint256 cafeId => bool) public planActive;

    event ConsumptionLogSet(address indexed consumptionLog);

    constructor(IERC20 pen_, ICafeRegistry registry_, address vault_, address networkFund_, address treasury_)
        Ownable(msg.sender)
    {
        if (
            address(pen_) == address(0) || address(registry_) == address(0) || vault_ == address(0)
                || networkFund_ == address(0) || treasury_ == address(0)
        ) revert ZeroAddress();
        pen = pen_;
        registry = registry_;
        vault = vault_;
        networkFund = networkFund_;
        treasury = treasury_;
    }

    /// @notice Points `consumeCredit` at the ConsumptionLog. address(0) disconnects emission entirely.
    function setConsumptionLog(address log) external onlyOwner {
        consumptionLog = log;
        emit ConsumptionLogSet(log);
    }

    /// @inheritdoc IPlanManager
    function subscribe(uint256 cafeId) external {
        _requireOperationalCaller(cafeId);
        _purchase(cafeId, PLAN_PRICE, PLAN_FUND_SHARE, PLAN_TREASURY_SHARE);
        planActive[cafeId] = true;
        emit PlanActivated(cafeId);
    }

    /// @inheritdoc IPlanManager
    function buyPack(uint256 cafeId) external {
        _requireOperationalCaller(cafeId);
        if (!planActive[cafeId]) revert PlanNotActive(cafeId);
        _purchase(cafeId, PACK_PRICE, PACK_FUND_SHARE, PACK_TREASURY_SHARE);
        emit PackPurchased(cafeId);
    }

    /// @inheritdoc IPlanManager
    function consumeCredit(uint256 cafeId) external {
        if (msg.sender != consumptionLog) revert NotConsumptionLog(msg.sender);
        if (!planActive[cafeId]) revert PlanNotActive(cafeId);
        if (!registry.isOperational(cafeId)) revert CafeNotOperational(cafeId);
        if (credits[cafeId] == 0) revert NoCredits(cafeId);

        credits[cafeId] -= 1;
        unallocatedReserve[cafeId] -= RESERVE_PER_CREDIT;
        pen.safeTransfer(vault, RESERVE_PER_CREDIT);
        emit EmissionCreditConsumed(cafeId);
    }

    /// @inheritdoc IPlanManager
    function cancel(uint256 cafeId) external {
        _requireCafeOwner(cafeId);
        if (!planActive[cafeId]) revert PlanNotActive(cafeId);
        planActive[cafeId] = false;
        emit PlanCancelled(cafeId);
    }

    /// @inheritdoc IPlanManager
    /// @dev No operational requirement: the owner of a suspended or exited café must
    /// still be able to recover the reserve of never-issued credits (spec §09).
    function withdrawUnusedReserve(uint256 cafeId) external {
        address cafeOwner = _requireCafeOwner(cafeId);
        if (planActive[cafeId]) revert PlanStillActive(cafeId);
        uint256 amount = unallocatedReserve[cafeId];
        if (amount == 0) revert NothingToWithdraw(cafeId);

        credits[cafeId] = 0;
        unallocatedReserve[cafeId] = 0;
        pen.safeTransfer(cafeOwner, amount);
        emit UnusedReserveWithdrawn(cafeId, amount);
    }

    /// @dev Split and credit accrual happen in one transaction (spec §17). The reserve
    /// share (price − fund − treasury) stays in this contract as unallocated reserve.
    function _purchase(uint256 cafeId, uint256 price, uint256 fundShare, uint256 treasuryShare) private {
        uint256 reserveShare = price - fundShare - treasuryShare;
        pen.safeTransferFrom(msg.sender, address(this), price);
        pen.safeTransfer(networkFund, fundShare);
        pen.safeTransfer(treasury, treasuryShare);
        credits[cafeId] += CREDITS_PER_PURCHASE;
        unallocatedReserve[cafeId] += reserveShare;
    }

    function _requireOperationalCaller(uint256 cafeId) private view {
        if (!registry.isAuthorized(cafeId, msg.sender)) revert NotAuthorizedForCafe(cafeId, msg.sender);
        if (!registry.isOperational(cafeId)) revert CafeNotOperational(cafeId);
    }

    function _requireCafeOwner(uint256 cafeId) private view returns (address cafeOwner) {
        (cafeOwner,) = registry.getCafe(cafeId);
        if (cafeOwner != msg.sender) revert NotCafeOwner(cafeId, msg.sender);
    }
}
```

Notes for the implementer:
- `ConsumptionLogSet` is a deliberate ops-observability event outside the frozen interface (same category as `setConsumptionLog` itself).
- When `consumptionLog == address(0)` (deploy default or emergency disconnect) no caller can pass the `msg.sender != consumptionLog` check, because `msg.sender` is never the zero address — emission is fully disconnected with no extra guard.

- [ ] **Step 5: Run the full suite**

Run from `packages/contracts/`: `forge test`
Expected: all tests pass, including `PlanManagerTest` (19 tests), remaining `ScaffoldTest` tests, `CafeRegistry*`, `MockPENTest`.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/PlanManager.sol packages/contracts/test/PlanManager.t.sol packages/contracts/test/Scaffold.t.sol
git commit -m "feat: implement PlanManager plan, credits, and reserve custody"
```

---

### Task 2: Fuzz + invariant tests

**Files:**
- Create: `packages/contracts/test/PlanManagerInvariant.t.sol`

**Interfaces:**
- Consumes: `PlanManager` exactly as produced by Task 1 (constructor, getters `credits`/`unallocatedReserve`/`planActive`, constants `PLAN_PRICE`/`PACK_PRICE`/`RESERVE_PER_CREDIT`, `setConsumptionLog`), `CafeRegistry`, `MockPEN`.
- Produces: nothing consumed later; guards the money-path invariants.

- [ ] **Step 1: Write the handler and invariant suite**

Create `packages/contracts/test/PlanManagerInvariant.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PlanManager} from "../src/PlanManager.sol";
import {CafeRegistry} from "../src/CafeRegistry.sol";
import {MockPEN} from "../src/MockPEN.sol";
import {ICafeRegistry} from "../src/interfaces/ICafeRegistry.sol";

/// @dev Drives random subscribe/buyPack/consume/cancel/withdraw sequences over a fixed
/// café set, guarding each call so only state-machine-legal actions execute. Tracks
/// ghost totals the invariants check against real balances.
contract PlanManagerHandler is Test {
    PlanManager internal immutable manager;
    MockPEN internal immutable pen;
    address internal immutable consumptionLog;

    uint256[] internal cafeIds;
    address[] internal cafeOwners;

    uint256 public totalConsumed;

    constructor(
        PlanManager manager_,
        MockPEN pen_,
        address consumptionLog_,
        uint256[] memory cafeIds_,
        address[] memory cafeOwners_
    ) {
        manager = manager_;
        pen = pen_;
        consumptionLog = consumptionLog_;
        cafeIds = cafeIds_;
        cafeOwners = cafeOwners_;
    }

    function _pick(uint256 seed) internal view returns (uint256 cafeId, address cafeOwner) {
        uint256 i = seed % cafeIds.length;
        return (cafeIds[i], cafeOwners[i]);
    }

    function subscribe(uint256 seed) external {
        (uint256 cafeId, address cafeOwner) = _pick(seed);
        vm.startPrank(cafeOwner);
        pen.faucet(manager.PLAN_PRICE());
        manager.subscribe(cafeId);
        vm.stopPrank();
    }

    function buyPack(uint256 seed) external {
        (uint256 cafeId, address cafeOwner) = _pick(seed);
        if (!manager.planActive(cafeId)) return;
        vm.startPrank(cafeOwner);
        pen.faucet(manager.PACK_PRICE());
        manager.buyPack(cafeId);
        vm.stopPrank();
    }

    function consume(uint256 seed) external {
        (uint256 cafeId,) = _pick(seed);
        if (!manager.planActive(cafeId) || manager.credits(cafeId) == 0) return;
        vm.prank(consumptionLog);
        manager.consumeCredit(cafeId);
        totalConsumed += 1;
    }

    function cancel(uint256 seed) external {
        (uint256 cafeId, address cafeOwner) = _pick(seed);
        if (!manager.planActive(cafeId)) return;
        vm.prank(cafeOwner);
        manager.cancel(cafeId);
    }

    function withdraw(uint256 seed) external {
        (uint256 cafeId, address cafeOwner) = _pick(seed);
        if (manager.planActive(cafeId) || manager.unallocatedReserve(cafeId) == 0) return;
        vm.prank(cafeOwner);
        manager.withdrawUnusedReserve(cafeId);
    }

    function cafeCount() external view returns (uint256) {
        return cafeIds.length;
    }

    function cafeIdAt(uint256 i) external view returns (uint256) {
        return cafeIds[i];
    }
}

contract PlanManagerInvariantTest is Test {
    uint256 internal constant NUM_CAFES = 3;

    MockPEN internal pen;
    CafeRegistry internal registry;
    PlanManager internal manager;
    PlanManagerHandler internal handler;

    address internal admin = makeAddr("admin");
    address internal vault = makeAddr("vault");
    address internal networkFund = makeAddr("networkFund");
    address internal treasury = makeAddr("treasury");
    address internal consumptionLog = makeAddr("consumptionLog");

    function setUp() public {
        pen = new MockPEN();
        registry = new CafeRegistry(admin);

        bytes32 registrarRole = registry.REGISTRAR_ROLE();
        vm.prank(admin);
        registry.grantRole(registrarRole, address(this));

        manager = new PlanManager(IERC20(address(pen)), registry, vault, networkFund, treasury);
        manager.setConsumptionLog(consumptionLog);

        uint256[] memory cafeIds = new uint256[](NUM_CAFES);
        address[] memory cafeOwners = new address[](NUM_CAFES);
        for (uint256 i = 0; i < NUM_CAFES; i++) {
            address cafeOwner = makeAddr(string.concat("cafeOwner", vm.toString(i)));
            uint256 cafeId = registry.registerCafe(cafeOwner);
            registry.setCafeStatus(cafeId, ICafeRegistry.CafeStatus.Active);
            vm.prank(cafeOwner);
            pen.approve(address(manager), type(uint256).max);
            cafeIds[i] = cafeId;
            cafeOwners[i] = cafeOwner;
        }

        handler = new PlanManagerHandler(manager, pen, consumptionLog, cafeIds, cafeOwners);
        targetContract(address(handler));
    }

    /// @notice Invariant 1 (spec): per café, unallocated reserve tracks credits exactly.
    function invariant_reserveMatchesCredits() public view {
        for (uint256 i = 0; i < handler.cafeCount(); i++) {
            uint256 cafeId = handler.cafeIdAt(i);
            assertEq(
                manager.unallocatedReserve(cafeId),
                manager.credits(cafeId) * manager.RESERVE_PER_CREDIT(),
                "unallocated reserve out of sync with credits"
            );
        }
    }

    /// @notice Invariant 2 (spec): the contract's mPEN balance equals the sum of all
    /// unallocated reserves — nothing else may accumulate or leak.
    function invariant_managerBalanceEqualsReserve() public view {
        uint256 total;
        for (uint256 i = 0; i < handler.cafeCount(); i++) {
            total += manager.unallocatedReserve(handler.cafeIdAt(i));
        }
        assertEq(pen.balanceOf(address(manager)), total, "manager balance diverged from reserve ledger");
    }

    /// @notice Every consumed credit moved exactly S/0.30 to the vault.
    function invariant_vaultPaidPerEmission() public view {
        assertEq(
            pen.balanceOf(vault),
            handler.totalConsumed() * manager.RESERVE_PER_CREDIT(),
            "vault balance diverged from consumed credits"
        );
    }
}
```

- [ ] **Step 2: Run the invariant suite**

Run from `packages/contracts/`: `forge test --match-contract PlanManagerInvariantTest`
Expected: 3 invariants PASS (default runs/depth).

- [ ] **Step 3: Run the full suite**

Run: `forge test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/test/PlanManagerInvariant.t.sol
git commit -m "test: add PlanManager fuzz handler and reserve invariants"
```

---

### Task 3: Deploy script

**Files:**
- Create: `packages/contracts/script/DeployPlanManager.s.sol`

**Interfaces:**
- Consumes: `PlanManager` constructor from Task 1.
- Produces: `DeployPlanManager.run() returns (PlanManager)` reading env vars `PEN_ADDRESS`, `CAFE_REGISTRY_ADDRESS`, `PUNCH_VAULT_ADDRESS`, `NETWORK_FUND_ADDRESS`, `TREASURY_ADDRESS`.

- [ ] **Step 1: Write the deploy script**

Create `packages/contracts/script/DeployPlanManager.s.sol` (pattern: `DeployMockPEN.s.sol`):

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PlanManager} from "../src/PlanManager.sol";
import {ICafeRegistry} from "../src/interfaces/ICafeRegistry.sol";

contract DeployPlanManager is Script {
    function run() external returns (PlanManager manager) {
        IERC20 pen = IERC20(vm.envAddress("PEN_ADDRESS"));
        ICafeRegistry registry = ICafeRegistry(vm.envAddress("CAFE_REGISTRY_ADDRESS"));
        address vault = vm.envAddress("PUNCH_VAULT_ADDRESS");
        address networkFund = vm.envAddress("NETWORK_FUND_ADDRESS");
        address treasury = vm.envAddress("TREASURY_ADDRESS");

        vm.startBroadcast();
        manager = new PlanManager(pen, registry, vault, networkFund, treasury);
        vm.stopBroadcast();
    }
}
```

Do NOT touch the shared `Deploy.s.sol`.

- [ ] **Step 2: Verify it compiles and the suite stays green**

Run from `packages/contracts/`: `forge build && forge test`
Expected: build succeeds, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/contracts/script/DeployPlanManager.s.sol
git commit -m "feat: add PlanManager deploy script"
```
