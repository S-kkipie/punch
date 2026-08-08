# PunchVault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `PunchVault` — non-transferable PUNCH ledger, balance-based reserve coverage on emission, and atomic 12-burn + S/3.60 payout on redemption — per `docs/superpowers/specs/2026-08-08-punchvault-design.md`.

**Architecture:** `PunchVault` implements the frozen `IPunchVault` interface plus `Ownable` and `Pausable`. Two separately settable rails: `consumptionLog` may call `issue` (coverage check: real mPEN balance must cover `(totalLivePunch+1) × 0.30e6`), `redeemer` may call `redeem` (validates balance ≥ 12, host operational, product reward-eligible; then burns 12 and pays S/3.60 to the host café's current registry owner in the same transaction). 12 × 0.30 = 3.60 exactly, so redemption preserves coverage by construction.

**Tech Stack:** Solidity ^0.8.30, Foundry (forge), OpenZeppelin (Ownable, Pausable, IERC20, SafeERC20), existing `CafeRegistry` and `MockPEN` as real test dependencies.

## Global Constraints

- Solidity `pragma solidity ^0.8.30;` — matches `foundry.toml` `solc_version = "0.8.30"`.
- Frozen interface `src/interfaces/IPunchVault.sol` must not change; ops functions (`setConsumptionLog`, `setRedeemer`, `pause`, `unpause`) live only on the contract.
- mPEN has 6 decimals. Exact constants (spec): `PUNCHES_PER_REWARD = 12`, `RESERVE_PER_PUNCH = 300_000`, `HOST_PAYOUT = 3_600_000` (12 × 300_000 = 3_600_000).
- Burn and payout are atomic — same transaction (master-spec invariant 8).
- Emission must revert if it would break coverage: `pen.balanceOf(vault) < (totalLivePunch + 1) × RESERVE_PER_PUNCH` (invariants 9-10).
- No PUNCH transfer or mPEN withdrawal path may exist — only egress is the redemption payout.
- Custom errors are free-standing at file level (repo convention; name collisions with other contracts' file-level errors are fine — named imports disambiguate).
- Foundry footgun: a view call after `vm.prank` consumes the prank — cache view results BEFORE pranking, or use `vm.startPrank`.
- All commands run from `packages/contracts/`. Run tests with `forge test`.
- PARALLEL-WORK GUARD: ConsumptionLog and NetworkFund are being built in other sessions right now. Touch ONLY this plan's files, plus removal of exactly the PunchVault stub pieces from `Scaffold.t.sol`. Never touch `ConsumptionLog.sol`, `NetworkFund.sol`, `CampaignEscrow.sol`, `PlanManager.sol`, `Deploy.s.sol`, or their tests.

---

### Task 1: PunchVault contract + unit tests

**Files:**
- Modify: `packages/contracts/src/PunchVault.sol` (replace stub entirely)
- Create: `packages/contracts/test/PunchVault.t.sol`
- Modify: `packages/contracts/test/Scaffold.t.sol` (remove PunchVault stub pieces — required for compilation, the stub constructs `new PunchVault()` with no args)

**Interfaces:**
- Consumes: `IPunchVault` (frozen), `ICafeRegistry` (`isOperational`, `isEligible`, `getCafe`, `ProductKind`), `MockPEN` (`mint onlyOwner`, `faucet`, ERC20), OpenZeppelin `Ownable`, `Pausable`, `IERC20`, `SafeERC20`.
- Produces: `PunchVault` with constructor `(IERC20 pen_, ICafeRegistry registry_)`, public getters `totalLivePunch()`, `consumptionLog()`, `redeemer()`, `balanceOf(address)`, constants `PUNCHES_PER_REWARD`/`RESERVE_PER_PUNCH`/`HOST_PAYOUT`, ops `setConsumptionLog(address)`/`setRedeemer(address)`/`pause()`/`unpause()` all `onlyOwner`. Tasks 2-3 rely on these exact names.

- [ ] **Step 1: Remove the PunchVault stub from `Scaffold.t.sol`**

In `packages/contracts/test/Scaffold.t.sol` delete exactly:
- the import line `import {PunchVault} from "../src/PunchVault.sol";`
- the field `PunchVault internal punchVault;`
- the setUp line `punchVault = new PunchVault();`
- the whole `test_punchVault_reverts_notImplemented` function

Leave every other stub test untouched (other sessions remove theirs on their own branches).

- [ ] **Step 2: Write the failing tests**

Create `packages/contracts/test/PunchVault.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    PunchVault,
    ZeroAddress,
    NotConsumptionLog,
    NotRedeemer,
    InsufficientReserve,
    InsufficientPunch,
    HostNotOperational,
    ProductNotEligibleReward
} from "../src/PunchVault.sol";
import {CafeRegistry} from "../src/CafeRegistry.sol";
import {MockPEN} from "../src/MockPEN.sol";
import {ICafeRegistry} from "../src/interfaces/ICafeRegistry.sol";
import {IPunchVault} from "../src/interfaces/IPunchVault.sol";

contract PunchVaultTest is Test {
    MockPEN internal pen;
    CafeRegistry internal registry;
    PunchVault internal vault;

    address internal admin = makeAddr("admin");
    address internal registrar = makeAddr("registrar");
    address internal emitterOwner = makeAddr("emitterOwner");
    address internal hostOwner = makeAddr("hostOwner");
    address internal consumptionLog = makeAddr("consumptionLog");
    address internal redeemer = makeAddr("redeemer");
    address internal alice = makeAddr("alice");
    address internal stranger = makeAddr("stranger");

    uint256 internal emitterCafeId;
    uint256 internal hostCafeId;
    uint256 internal constant PRODUCT_ID = 7;

    function setUp() public {
        pen = new MockPEN();
        registry = new CafeRegistry(admin);

        // Cache the role before pranking: the view call would consume a vm.prank.
        bytes32 registrarRole = registry.REGISTRAR_ROLE();
        vm.prank(admin);
        registry.grantRole(registrarRole, registrar);

        vm.startPrank(registrar);
        emitterCafeId = registry.registerCafe(emitterOwner);
        registry.setCafeStatus(emitterCafeId, ICafeRegistry.CafeStatus.Active);
        hostCafeId = registry.registerCafe(hostOwner);
        registry.setCafeStatus(hostCafeId, ICafeRegistry.CafeStatus.Active);
        vm.stopPrank();

        vm.prank(hostOwner);
        registry.setEligibleProduct(hostCafeId, PRODUCT_ID, ICafeRegistry.ProductKind.Reward, true);

        vault = new PunchVault(IERC20(address(pen)), registry);
        vault.setConsumptionLog(consumptionLog);
        vault.setRedeemer(redeemer);
    }

    /// @dev Simulates the orchestrated emission: PlanManager forwards S/0.30 per credit
    /// to the vault, then ConsumptionLog calls issue. Test contract owns MockPEN.
    function _issue(address user, uint256 n) internal {
        pen.mint(address(vault), n * 300_000);
        vm.startPrank(consumptionLog);
        for (uint256 i = 0; i < n; i++) {
            vault.issue(user, emitterCafeId);
        }
        vm.stopPrank();
    }

    function test_constructor_zeroAddressReverts() public {
        vm.expectRevert(ZeroAddress.selector);
        new PunchVault(IERC20(address(0)), registry);
    }

    function test_issue_creditsAndEmits() public {
        pen.mint(address(vault), 300_000);
        vm.expectEmit(true, true, false, true);
        emit IPunchVault.PunchIssued(alice, emitterCafeId);
        vm.prank(consumptionLog);
        vault.issue(alice, emitterCafeId);

        assertEq(vault.balanceOf(alice), 1);
        assertEq(vault.totalLivePunch(), 1);
    }

    function test_issue_wrongCallerReverts() public {
        pen.mint(address(vault), 300_000);
        vm.expectRevert(abi.encodeWithSelector(NotConsumptionLog.selector, stranger));
        vm.prank(stranger);
        vault.issue(alice, emitterCafeId);
    }

    function test_issue_zeroUserReverts() public {
        pen.mint(address(vault), 300_000);
        vm.expectRevert(ZeroAddress.selector);
        vm.prank(consumptionLog);
        vault.issue(address(0), emitterCafeId);
    }

    function test_issue_noReserveReverts() public {
        vm.expectRevert(abi.encodeWithSelector(InsufficientReserve.selector, 300_000, 0));
        vm.prank(consumptionLog);
        vault.issue(alice, emitterCafeId);
    }

    function test_issue_reserveShortByOneReverts() public {
        pen.mint(address(vault), 300_000 - 1);
        vm.expectRevert(abi.encodeWithSelector(InsufficientReserve.selector, 300_000, 300_000 - 1));
        vm.prank(consumptionLog);
        vault.issue(alice, emitterCafeId);
    }

    function test_issue_exactCoveragePasses() public {
        _issue(alice, 1);
        pen.mint(address(vault), 300_000);
        vm.prank(consumptionLog);
        vault.issue(alice, emitterCafeId);
        assertEq(vault.balanceOf(alice), 2);
        assertEq(pen.balanceOf(address(vault)), 2 * 300_000);
    }

    function test_issue_whenPausedReverts() public {
        pen.mint(address(vault), 300_000);
        vault.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(consumptionLog);
        vault.issue(alice, emitterCafeId);
    }

    function test_redeem_burnsPaysAndEmits() public {
        _issue(alice, 12);

        vm.expectEmit(true, false, false, true);
        emit IPunchVault.PunchBurned(alice, 12);
        vm.expectEmit(true, true, true, true);
        emit IPunchVault.RewardRedeemed(alice, hostCafeId, PRODUCT_ID);
        vm.expectEmit(true, false, false, true);
        emit IPunchVault.HostPaid(hostCafeId, 3_600_000);
        vm.prank(redeemer);
        vault.redeem(alice, hostCafeId, PRODUCT_ID);

        assertEq(vault.balanceOf(alice), 0);
        assertEq(vault.totalLivePunch(), 0);
        assertEq(pen.balanceOf(hostOwner), 3_600_000);
        assertEq(pen.balanceOf(address(vault)), 0); // 12 × 0.30 in, 3.60 out — exact symmetry
    }

    function test_redeem_wrongCallerReverts() public {
        _issue(alice, 12);
        vm.expectRevert(abi.encodeWithSelector(NotRedeemer.selector, stranger));
        vm.prank(stranger);
        vault.redeem(alice, hostCafeId, PRODUCT_ID);
    }

    function test_redeem_below12Reverts() public {
        _issue(alice, 11);
        vm.expectRevert(abi.encodeWithSelector(InsufficientPunch.selector, alice, 11));
        vm.prank(redeemer);
        vault.redeem(alice, hostCafeId, PRODUCT_ID);
    }

    function test_redeem_hostSuspendedReverts() public {
        _issue(alice, 12);
        vm.prank(registrar);
        registry.setCafeStatus(hostCafeId, ICafeRegistry.CafeStatus.Suspended);
        vm.expectRevert(abi.encodeWithSelector(HostNotOperational.selector, hostCafeId));
        vm.prank(redeemer);
        vault.redeem(alice, hostCafeId, PRODUCT_ID);
    }

    function test_redeem_productNotEligibleReverts() public {
        _issue(alice, 12);
        uint256 otherProduct = 99;
        vm.expectRevert(
            abi.encodeWithSelector(ProductNotEligibleReward.selector, hostCafeId, otherProduct)
        );
        vm.prank(redeemer);
        vault.redeem(alice, hostCafeId, otherProduct);
    }

    function test_redeem_whenPausedReverts() public {
        _issue(alice, 12);
        vault.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(redeemer);
        vault.redeem(alice, hostCafeId, PRODUCT_ID);
    }

    function test_redeem_survivesEmitterExit() public {
        _issue(alice, 12);
        vm.prank(registrar);
        registry.setCafeStatus(emitterCafeId, ICafeRegistry.CafeStatus.Exited);

        vm.prank(redeemer);
        vault.redeem(alice, hostCafeId, PRODUCT_ID);
        assertEq(vault.balanceOf(alice), 0);
        assertEq(pen.balanceOf(hostOwner), 3_600_000);
    }

    function test_redeem_payoutFollowsOwnershipTransfer() public {
        _issue(alice, 12);
        address newHostOwner = makeAddr("newHostOwner");
        vm.prank(hostOwner);
        registry.proposeOwner(hostCafeId, newHostOwner);
        vm.prank(newHostOwner);
        registry.acceptOwnership(hostCafeId);

        vm.prank(redeemer);
        vault.redeem(alice, hostCafeId, PRODUCT_ID);
        assertEq(pen.balanceOf(newHostOwner), 3_600_000);
        assertEq(pen.balanceOf(hostOwner), 0);
    }

    function test_ops_onlyOwner() public {
        vm.startPrank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vault.setConsumptionLog(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vault.setRedeemer(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vault.pause();
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vault.unpause();
        vm.stopPrank();
    }

    function test_ops_zeroDisconnectsRails() public {
        pen.mint(address(vault), 300_000);
        vault.setConsumptionLog(address(0));
        vm.expectRevert(abi.encodeWithSelector(NotConsumptionLog.selector, consumptionLog));
        vm.prank(consumptionLog);
        vault.issue(alice, emitterCafeId);

        vault.setRedeemer(address(0));
        vm.expectRevert(abi.encodeWithSelector(NotRedeemer.selector, redeemer));
        vm.prank(redeemer);
        vault.redeem(alice, hostCafeId, PRODUCT_ID);
    }

    function test_unpause_restoresIssue() public {
        pen.mint(address(vault), 300_000);
        vault.pause();
        vault.unpause();
        vm.prank(consumptionLog);
        vault.issue(alice, emitterCafeId);
        assertEq(vault.balanceOf(alice), 1);
    }
}
```

- [ ] **Step 3: Run tests to verify they fail to compile**

Run from `packages/contracts/`: `forge test --match-contract PunchVaultTest`
Expected: compilation failure (stub `PunchVault` has no constructor args, no `totalLivePunch`, no errors).

- [ ] **Step 4: Implement PunchVault**

Replace `packages/contracts/src/PunchVault.sol` entirely with:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPunchVault} from "./interfaces/IPunchVault.sol";
import {ICafeRegistry} from "./interfaces/ICafeRegistry.sol";

error ZeroAddress();
error NotConsumptionLog(address caller);
error NotRedeemer(address caller);
error InsufficientReserve(uint256 required, uint256 available);
error InsufficientPunch(address user, uint256 balance);
error HostNotOperational(uint256 cafeId);
error ProductNotEligibleReward(uint256 cafeId, uint256 productId);

/// @notice Non-transferable PUNCH ledger and reward-reserve custodian. Issues one PUNCH
/// per validated consumption, and on redemption atomically burns twelve and pays the
/// fixed S/3.60 host payout from the reserve (12 × S/0.30 = S/3.60, so redemption
/// preserves coverage by construction; only emission needs the explicit check).
/// @dev Two independently settable rails: `consumptionLog` may issue, `redeemer` may
/// redeem. The vault records no per-café provenance for live PUNCH — a user's balance
/// stays valid if the emitting café leaves the network. No transfer or withdrawal path
/// exists; the redemption payout is the only mPEN egress.
contract PunchVault is IPunchVault, Ownable, Pausable {
    using SafeERC20 for IERC20;

    uint256 public constant PUNCHES_PER_REWARD = 12;
    uint256 public constant RESERVE_PER_PUNCH = 300_000; // S/0.30
    uint256 public constant HOST_PAYOUT = 3_600_000; // S/3.60

    IERC20 public immutable pen;
    ICafeRegistry public immutable registry;

    /// @notice Only address allowed to call `issue`; the ConsumptionLog contract in production.
    address public consumptionLog;
    /// @notice Only address allowed to call `redeem`; the redemption backend in production.
    address public redeemer;

    mapping(address user => uint256) private _balances;
    uint256 public totalLivePunch;

    event ConsumptionLogSet(address indexed consumptionLog);
    event RedeemerSet(address indexed redeemer);

    constructor(IERC20 pen_, ICafeRegistry registry_) Ownable(msg.sender) {
        if (address(pen_) == address(0) || address(registry_) == address(0)) revert ZeroAddress();
        pen = pen_;
        registry = registry_;
    }

    /// @notice Points `issue` at the ConsumptionLog. address(0) disconnects the emission rail.
    function setConsumptionLog(address log) external onlyOwner {
        consumptionLog = log;
        emit ConsumptionLogSet(log);
    }

    /// @notice Points `redeem` at the redemption backend. address(0) disconnects the redemption rail.
    function setRedeemer(address redeemer_) external onlyOwner {
        redeemer = redeemer_;
        emit RedeemerSet(redeemer_);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @inheritdoc IPunchVault
    /// @dev Coverage is checked against the real mPEN balance: PlanManager has already
    /// forwarded S/0.30 for this credit earlier in the same orchestrated transaction,
    /// so a compliant flow always passes. Donations only raise coverage. No registry
    /// checks here — ConsumptionLog validates the proof and PlanManager validates plan,
    /// café status, and credit before this call. `cafeId` flows only to the event.
    function issue(address user, uint256 cafeId) external whenNotPaused {
        if (msg.sender != consumptionLog) revert NotConsumptionLog(msg.sender);
        if (user == address(0)) revert ZeroAddress();

        uint256 required = (totalLivePunch + 1) * RESERVE_PER_PUNCH;
        uint256 available = pen.balanceOf(address(this));
        if (available < required) revert InsufficientReserve(required, available);

        _balances[user] += 1;
        totalLivePunch += 1;
        emit PunchIssued(user, cafeId);
    }

    /// @inheritdoc IPunchVault
    /// @dev Burn and payout are one transaction (master-spec invariant 8). The payout
    /// goes to the host café's current owner in the registry, so a two-step ownership
    /// transfer redirects payouts with no vault state.
    function redeem(address user, uint256 hostCafeId, uint256 productId) external whenNotPaused {
        if (msg.sender != redeemer) revert NotRedeemer(msg.sender);

        uint256 balance = _balances[user];
        if (balance < PUNCHES_PER_REWARD) revert InsufficientPunch(user, balance);
        if (!registry.isOperational(hostCafeId)) revert HostNotOperational(hostCafeId);
        if (!registry.isEligible(hostCafeId, productId, ICafeRegistry.ProductKind.Reward)) {
            revert ProductNotEligibleReward(hostCafeId, productId);
        }
        (address hostOwner,) = registry.getCafe(hostCafeId);

        _balances[user] = balance - PUNCHES_PER_REWARD;
        totalLivePunch -= PUNCHES_PER_REWARD;
        pen.safeTransfer(hostOwner, HOST_PAYOUT);
        emit PunchBurned(user, PUNCHES_PER_REWARD);
        emit RewardRedeemed(user, hostCafeId, productId);
        emit HostPaid(hostCafeId, HOST_PAYOUT);
    }

    /// @inheritdoc IPunchVault
    function balanceOf(address user) external view returns (uint256) {
        return _balances[user];
    }
}
```

- [ ] **Step 5: Run the full suite**

Run from `packages/contracts/`: `forge test`
Expected: all tests pass, including `PunchVaultTest` (18 tests) and the remaining `ScaffoldTest` tests.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/PunchVault.sol packages/contracts/test/PunchVault.t.sol packages/contracts/test/Scaffold.t.sol
git commit -m "feat: implement PunchVault ledger, coverage, and redemption"
```

---

### Task 2: Invariant tests

**Files:**
- Create: `packages/contracts/test/PunchVaultInvariant.t.sol`

**Interfaces:**
- Consumes: `PunchVault` exactly as produced by Task 1 (constructor `(IERC20, ICafeRegistry)`, getters `balanceOf`/`totalLivePunch`/`paused`, constants `PUNCHES_PER_REWARD`/`RESERVE_PER_PUNCH`/`HOST_PAYOUT`, ops `setConsumptionLog`/`setRedeemer`/`pause`/`unpause`/`transferOwnership`), `CafeRegistry`, `MockPEN` (`faucet` — capped 1_000e6 per call).
- Produces: nothing consumed later; guards the money-path invariants.

- [ ] **Step 1: Write the handler and invariant suite**

Create `packages/contracts/test/PunchVaultInvariant.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PunchVault} from "../src/PunchVault.sol";
import {CafeRegistry} from "../src/CafeRegistry.sol";
import {MockPEN} from "../src/MockPEN.sol";
import {ICafeRegistry} from "../src/interfaces/ICafeRegistry.sol";

/// @dev Drives random funded/unfunded issues, donations, redemptions, and pause flips.
/// Owns the vault (for pause) and funds it via the public faucet. `issueUnfunded`
/// deliberately attempts emission without adding reserve — it may only succeed when
/// donations left surplus coverage; the coverage invariant is what proves that.
contract PunchVaultHandler is Test {
    PunchVault internal immutable vault;
    MockPEN internal immutable pen;
    address internal immutable consumptionLog;
    address internal immutable redeemer;
    uint256 internal immutable emitterCafeId;
    uint256 internal immutable hostCafeId;
    uint256 internal immutable productId;

    address[] internal users;

    uint256 public totalRedeems;

    constructor(
        PunchVault vault_,
        MockPEN pen_,
        address consumptionLog_,
        address redeemer_,
        uint256 emitterCafeId_,
        uint256 hostCafeId_,
        uint256 productId_,
        address[] memory users_
    ) {
        vault = vault_;
        pen = pen_;
        consumptionLog = consumptionLog_;
        redeemer = redeemer_;
        emitterCafeId = emitterCafeId_;
        hostCafeId = hostCafeId_;
        productId = productId_;
        users = users_;
    }

    function _user(uint256 seed) internal view returns (address) {
        return users[seed % users.length];
    }

    function fundAndIssue(uint256 seed) external {
        if (vault.paused()) return;
        uint256 amount = vault.RESERVE_PER_PUNCH();
        pen.faucet(amount);
        pen.transfer(address(vault), amount);
        vm.prank(consumptionLog);
        vault.issue(_user(seed), emitterCafeId);
    }

    function issueUnfunded(uint256 seed) external {
        if (vault.paused()) return;
        address user = _user(seed);
        vm.prank(consumptionLog);
        try vault.issue(user, emitterCafeId) {} catch {}
    }

    function donate(uint256 seed) external {
        uint256 amount = bound(seed, 1, 10e6);
        pen.faucet(amount);
        pen.transfer(address(vault), amount);
    }

    function redeemOne(uint256 seed) external {
        if (vault.paused()) return;
        address user = _user(seed);
        if (vault.balanceOf(user) < vault.PUNCHES_PER_REWARD()) return;
        vm.prank(redeemer);
        vault.redeem(user, hostCafeId, productId);
        totalRedeems += 1;
    }

    function togglePause() external {
        if (vault.paused()) {
            vault.unpause();
        } else {
            vault.pause();
        }
    }

    function userCount() external view returns (uint256) {
        return users.length;
    }

    function userAt(uint256 i) external view returns (address) {
        return users[i];
    }
}

contract PunchVaultInvariantTest is Test {
    MockPEN internal pen;
    CafeRegistry internal registry;
    PunchVault internal vault;
    PunchVaultHandler internal handler;

    address internal admin = makeAddr("admin");
    address internal emitterOwner = makeAddr("emitterOwner");
    address internal hostOwner = makeAddr("hostOwner");
    address internal consumptionLog = makeAddr("consumptionLog");
    address internal redeemer = makeAddr("redeemer");

    uint256 internal constant PRODUCT_ID = 7;

    function setUp() public {
        pen = new MockPEN();
        registry = new CafeRegistry(admin);

        bytes32 registrarRole = registry.REGISTRAR_ROLE();
        vm.prank(admin);
        registry.grantRole(registrarRole, address(this));

        uint256 emitterCafeId = registry.registerCafe(emitterOwner);
        registry.setCafeStatus(emitterCafeId, ICafeRegistry.CafeStatus.Active);
        uint256 hostCafeId = registry.registerCafe(hostOwner);
        registry.setCafeStatus(hostCafeId, ICafeRegistry.CafeStatus.Active);

        vm.prank(hostOwner);
        registry.setEligibleProduct(hostCafeId, PRODUCT_ID, ICafeRegistry.ProductKind.Reward, true);

        vault = new PunchVault(IERC20(address(pen)), registry);
        vault.setConsumptionLog(consumptionLog);
        vault.setRedeemer(redeemer);

        address[] memory users = new address[](3);
        users[0] = makeAddr("user0");
        users[1] = makeAddr("user1");
        users[2] = makeAddr("user2");

        handler = new PunchVaultHandler(
            vault, pen, consumptionLog, redeemer, emitterCafeId, hostCafeId, PRODUCT_ID, users
        );
        vault.transferOwnership(address(handler)); // handler flips pause
        targetContract(address(handler));
    }

    /// @notice Invariant 1 (spec): every live PUNCH is covered by S/0.30 of real balance.
    function invariant_coverage() public view {
        assertGe(
            pen.balanceOf(address(vault)),
            vault.totalLivePunch() * vault.RESERVE_PER_PUNCH(),
            "live PUNCH not fully covered by reserve balance"
        );
    }

    /// @notice Invariant 2 (spec): the global counter equals the sum of user balances.
    function invariant_conservation() public view {
        uint256 sum;
        for (uint256 i = 0; i < handler.userCount(); i++) {
            sum += vault.balanceOf(handler.userAt(i));
        }
        assertEq(vault.totalLivePunch(), sum, "totalLivePunch diverged from user balances");
    }

    /// @notice Invariant 3 (spec): mPEN only leaves as exact host payouts.
    function invariant_payoutsExact() public view {
        assertEq(
            pen.balanceOf(hostOwner),
            handler.totalRedeems() * vault.HOST_PAYOUT(),
            "host payouts diverged from redemption count"
        );
    }
}
```

- [ ] **Step 2: Run the invariant suite**

Run from `packages/contracts/`: `forge test --match-contract PunchVaultInvariantTest`
Expected: 3 invariants PASS (default runs/depth).

- [ ] **Step 3: Run the full suite**

Run: `forge test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/test/PunchVaultInvariant.t.sol
git commit -m "test: add PunchVault coverage and conservation invariants"
```

---

### Task 3: Deploy script

**Files:**
- Create: `packages/contracts/script/DeployPunchVault.s.sol`

**Interfaces:**
- Consumes: `PunchVault` constructor `(IERC20, ICafeRegistry)` from Task 1.
- Produces: `DeployPunchVault.run() returns (PunchVault)` reading env vars `PEN_ADDRESS`, `CAFE_REGISTRY_ADDRESS`.

- [ ] **Step 1: Write the deploy script**

Create `packages/contracts/script/DeployPunchVault.s.sol` (pattern: `DeployMockPEN.s.sol`):

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PunchVault} from "../src/PunchVault.sol";
import {ICafeRegistry} from "../src/interfaces/ICafeRegistry.sol";

contract DeployPunchVault is Script {
    function run() external returns (PunchVault vault) {
        IERC20 pen = IERC20(vm.envAddress("PEN_ADDRESS"));
        ICafeRegistry registry = ICafeRegistry(vm.envAddress("CAFE_REGISTRY_ADDRESS"));

        vm.startBroadcast();
        vault = new PunchVault(pen, registry);
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
git add packages/contracts/script/DeployPunchVault.s.sol
git commit -m "feat: add PunchVault deploy script"
```
