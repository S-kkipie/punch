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
