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
