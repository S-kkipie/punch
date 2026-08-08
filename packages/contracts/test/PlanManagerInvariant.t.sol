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
