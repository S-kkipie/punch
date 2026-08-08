// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ConsumptionLog} from "../src/ConsumptionLog.sol";
import {PlanManager} from "../src/PlanManager.sol";
import {CafeRegistry} from "../src/CafeRegistry.sol";
import {MockPEN} from "../src/MockPEN.sol";
import {ICafeRegistry} from "../src/interfaces/ICafeRegistry.sol";
import {IConsumptionLog} from "../src/interfaces/IConsumptionLog.sol";
import {IPunchVault} from "../src/interfaces/IPunchVault.sol";

/// @dev Counts issuance so invariants can compare it against credits consumed.
contract CountingVault is IPunchVault {
    uint256 public issueCount;

    function issue(address user, uint256 cafeId) external {
        issueCount += 1;
        emit PunchIssued(user, cafeId);
    }

    function redeem(address, uint256, uint256) external {}

    function balanceOf(address) external pure returns (uint256) {
        return 0;
    }
}

/// @dev Fires random proofs — valid and malformed — at ConsumptionLog over a small café
/// and user set, swallowing reverts so the fuzzer explores rejected paths too. Ghost
/// counters record what actually succeeded.
contract ConsumptionLogHandler is Test {
    ConsumptionLog internal immutable consumptionLog;
    PlanManager internal immutable manager;
    CountingVault internal immutable vault;

    uint256[] internal cafeIds;
    uint256[] internal operatorKeys;
    uint256[] internal userKeys;

    uint256 public successfulRecords;

    constructor(
        ConsumptionLog log_,
        PlanManager manager_,
        CountingVault vault_,
        uint256[] memory cafeIds_,
        uint256[] memory operatorKeys_,
        uint256[] memory userKeys_
    ) {
        consumptionLog = log_;
        manager = manager_;
        vault = vault_;
        cafeIds = cafeIds_;
        operatorKeys = operatorKeys_;
        userKeys = userKeys_;
    }

    function record(uint256 cafeSeed, uint256 userSeed, uint256 nonce, uint256 amount, bool validCafeSig) external {
        uint256 i = cafeSeed % cafeIds.length;
        uint256 j = userSeed % userKeys.length;
        uint256 userKey = userKeys[j];

        IConsumptionLog.ConsumptionProof memory proof = IConsumptionLog.ConsumptionProof({
            cafeId: cafeIds[i],
            user: vm.addr(userKey),
            productId: 1,
            amount: bound(amount, 1e6, 100e6),
            receiptHash: keccak256(abi.encodePacked(cafeIds[i], nonce)),
            nonce: nonce,
            expiry: block.timestamp + 1 minutes
        });

        bytes32 digest = consumptionLog.hashProof(proof);
        uint256 cafeKey = validCafeSig ? operatorKeys[i] : userKey;
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(cafeKey, digest);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(userKey, digest);

        try consumptionLog.recordConsumption(proof, abi.encodePacked(r1, s1, v1), abi.encodePacked(r2, s2, v2)) {
            successfulRecords += 1;
        } catch {}
    }

    function warp(uint256 secondsAhead) external {
        vm.warp(block.timestamp + bound(secondsAhead, 1, 2 days));
    }

    function cafeIdAt(uint256 i) external view returns (uint256) {
        return cafeIds[i];
    }

    function userAt(uint256 i) external view returns (address) {
        return vm.addr(userKeys[i]);
    }

    function cafeCount() external view returns (uint256) {
        return cafeIds.length;
    }

    function userCount() external view returns (uint256) {
        return userKeys.length;
    }
}

contract ConsumptionLogInvariantTest is Test {
    MockPEN internal pen;
    CafeRegistry internal registry;
    PlanManager internal manager;
    CountingVault internal vault;
    ConsumptionLog internal consumptionLog;
    ConsumptionLogHandler internal handler;

    address internal admin = makeAddr("admin");
    address internal registrar = makeAddr("registrar");
    address internal networkFund = makeAddr("networkFund");
    address internal treasury = makeAddr("treasury");

    uint256 internal totalCreditsBought;

    function setUp() public {
        pen = new MockPEN();
        registry = new CafeRegistry(admin);

        bytes32 registrarRole = registry.REGISTRAR_ROLE();
        vm.prank(admin);
        registry.grantRole(registrarRole, registrar);

        vault = new CountingVault();
        manager = new PlanManager(IERC20(address(pen)), registry, address(vault), networkFund, treasury);
        consumptionLog = new ConsumptionLog(registry, manager, vault);
        manager.setConsumptionLog(address(consumptionLog));

        uint256[] memory cafeIds = new uint256[](3);
        uint256[] memory operatorKeys = new uint256[](3);
        for (uint256 i = 0; i < 3; i++) {
            (address cafeOwner,) = makeAddrAndKey(string.concat("owner", vm.toString(i)));
            (address operator, uint256 operatorKey) = makeAddrAndKey(string.concat("operator", vm.toString(i)));
            operatorKeys[i] = operatorKey;

            vm.startPrank(registrar);
            cafeIds[i] = registry.registerCafe(cafeOwner);
            registry.setCafeStatus(cafeIds[i], ICafeRegistry.CafeStatus.Active);
            vm.stopPrank();

            vm.startPrank(cafeOwner);
            registry.authorizeOperator(cafeIds[i], operator, true);
            registry.setEligibleProduct(cafeIds[i], 1, ICafeRegistry.ProductKind.Emission, true);
            pen.faucet(1_000e6);
            pen.approve(address(manager), type(uint256).max);
            manager.subscribe(cafeIds[i]);
            vm.stopPrank();
            totalCreditsBought += 100;
        }

        uint256[] memory userKeys = new uint256[](2);
        (, userKeys[0]) = makeAddrAndKey("invUser0");
        (, userKeys[1]) = makeAddrAndKey("invUser1");

        handler = new ConsumptionLogHandler(consumptionLog, manager, vault, cafeIds, operatorKeys, userKeys);
        targetContract(address(handler));
    }

    /// @dev Invariant 2 of the mother spec: one valid purchase, exactly one PUNCH.
    function invariant_issuanceMatchesCreditsConsumed() public view {
        uint256 creditsLeft;
        for (uint256 i = 0; i < handler.cafeCount(); i++) {
            creditsLeft += manager.credits(handler.cafeIdAt(i));
        }
        assertEq(vault.issueCount(), totalCreditsBought - creditsLeft);
        assertEq(vault.issueCount(), handler.successfulRecords());
    }

    /// @dev Invariant 9: every live PUNCH is backed by S/0.30 in the vault.
    function invariant_vaultReserveMatchesIssuance() public view {
        assertEq(pen.balanceOf(address(vault)), vault.issueCount() * 300_000);
    }

    /// @dev The daily cap is never exceeded for any (café, user) pair on the current day.
    function invariant_dailyCapNeverExceeded() public view {
        uint256 day = block.timestamp / 1 days;
        uint256 cap = consumptionLog.maxDailyPerUserCafe();
        for (uint256 i = 0; i < handler.cafeCount(); i++) {
            for (uint256 j = 0; j < handler.userCount(); j++) {
                assertLe(consumptionLog.dailyCount(handler.cafeIdAt(i), handler.userAt(j), day), cap);
            }
        }
    }

    function afterInvariant() public view {
        assertGt(handler.successfulRecords(), 0);
    }
}
