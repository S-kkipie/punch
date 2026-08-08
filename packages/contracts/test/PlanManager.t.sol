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
