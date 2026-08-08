// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ConsumptionLog, ZeroAddress, InvalidLimit} from "../src/ConsumptionLog.sol";
import {PlanManager} from "../src/PlanManager.sol";
import {CafeRegistry} from "../src/CafeRegistry.sol";
import {MockPEN} from "../src/MockPEN.sol";
import {ICafeRegistry} from "../src/interfaces/ICafeRegistry.sol";
import {IConsumptionLog} from "../src/interfaces/IConsumptionLog.sol";
import {IPunchVault} from "../src/interfaces/IPunchVault.sol";
import {IPlanManager} from "../src/interfaces/IPlanManager.sol";

/// @dev Stands in for the real PunchVault, which another workstream owns. Records what
/// ConsumptionLog asked for and can be told to revert, so orchestration and atomicity
/// are testable against the frozen IPunchVault.
contract MockPunchVault is IPunchVault {
    uint256 public issueCount;
    address public lastUser;
    uint256 public lastCafeId;
    bool public shouldRevert;

    error MockVaultReverted();

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function issue(address user, uint256 cafeId) external {
        if (shouldRevert) revert MockVaultReverted();
        issueCount += 1;
        lastUser = user;
        lastCafeId = cafeId;
        emit PunchIssued(user, cafeId);
    }

    function redeem(address, uint256, uint256) external {}

    function balanceOf(address) external pure returns (uint256) {
        return 0;
    }
}

contract ConsumptionLogTest is Test {
    MockPEN internal pen;
    CafeRegistry internal registry;
    PlanManager internal manager;
    MockPunchVault internal vault;
    ConsumptionLog internal consumptionLog;

    address internal admin = makeAddr("admin");
    address internal registrar = makeAddr("registrar");
    address internal cafeOwner = makeAddr("cafeOwner");
    address internal networkFund = makeAddr("networkFund");
    address internal treasury = makeAddr("treasury");
    address internal stranger = makeAddr("stranger");

    address internal operator;
    uint256 internal operatorKey;
    address internal user;
    uint256 internal userKey;

    uint256 internal cafeId;
    uint256 internal constant PRODUCT_ID = 7;

    function setUp() public {
        (operator, operatorKey) = makeAddrAndKey("operator");
        (user, userKey) = makeAddrAndKey("user");

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

        vm.startPrank(cafeOwner);
        registry.authorizeOperator(cafeId, operator, true);
        registry.setEligibleProduct(cafeId, PRODUCT_ID, ICafeRegistry.ProductKind.Emission, true);
        vm.stopPrank();

        vault = new MockPunchVault();
        manager = new PlanManager(IERC20(address(pen)), registry, address(vault), networkFund, treasury);
        consumptionLog = new ConsumptionLog(registry, manager, vault);
        manager.setConsumptionLog(address(consumptionLog));

        vm.startPrank(cafeOwner);
        pen.faucet(1_000e6);
        pen.approve(address(manager), type(uint256).max);
        manager.subscribe(cafeId);
        vm.stopPrank();
    }

    function _proof(uint256 nonce) internal view returns (IConsumptionLog.ConsumptionProof memory) {
        return IConsumptionLog.ConsumptionProof({
            cafeId: cafeId,
            user: user,
            productId: PRODUCT_ID,
            amount: 12e6,
            receiptHash: keccak256(abi.encodePacked("receipt", nonce)),
            nonce: nonce,
            expiry: block.timestamp + 5 minutes
        });
    }

    function test_constructor_setsDependenciesAndDefaults() public view {
        assertEq(address(consumptionLog.registry()), address(registry));
        assertEq(address(consumptionLog.planManager()), address(manager));
        assertEq(address(consumptionLog.punchVault()), address(vault));
        assertEq(consumptionLog.minTicketAmount(), 8e6);
        assertEq(consumptionLog.maxDailyPerUserCafe(), 3);
        assertEq(consumptionLog.MAX_PROOF_TTL(), 15 minutes);
        assertEq(consumptionLog.owner(), address(this));
    }

    function test_constructor_zeroAddressReverts() public {
        vm.expectRevert(ZeroAddress.selector);
        new ConsumptionLog(ICafeRegistry(address(0)), manager, vault);
        vm.expectRevert(ZeroAddress.selector);
        new ConsumptionLog(registry, IPlanManager(address(0)), vault);
        vm.expectRevert(ZeroAddress.selector);
        new ConsumptionLog(registry, manager, IPunchVault(address(0)));
    }

    function test_hashProof_matchesEip712Digest() public view {
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "ConsumptionProof(uint256 cafeId,address user,uint256 productId,uint256 amount,bytes32 receiptHash,uint256 nonce,uint256 expiry)"
                ),
                proof.cafeId,
                proof.user,
                proof.productId,
                proof.amount,
                proof.receiptHash,
                proof.nonce,
                proof.expiry
            )
        );
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("PUNCH ConsumptionLog")),
                keccak256(bytes("1")),
                block.chainid,
                address(consumptionLog)
            )
        );
        bytes32 expected = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        assertEq(consumptionLog.hashProof(proof), expected);
    }

    function test_setMinTicketAmount_ownerOnlyAndEmits() public {
        vm.expectEmit(false, false, false, true);
        emit ConsumptionLog.MinTicketAmountSet(10e6);
        consumptionLog.setMinTicketAmount(10e6);
        assertEq(consumptionLog.minTicketAmount(), 10e6);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        consumptionLog.setMinTicketAmount(1e6);
    }

    function test_setMaxDailyPerUserCafe_ownerOnlyAndEmits() public {
        vm.expectEmit(false, false, false, true);
        emit ConsumptionLog.MaxDailyPerUserCafeSet(5);
        consumptionLog.setMaxDailyPerUserCafe(5);
        assertEq(consumptionLog.maxDailyPerUserCafe(), 5);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        consumptionLog.setMaxDailyPerUserCafe(5);
    }

    function test_setLimits_zeroReverts() public {
        vm.expectRevert(InvalidLimit.selector);
        consumptionLog.setMinTicketAmount(0);
        vm.expectRevert(InvalidLimit.selector);
        consumptionLog.setMaxDailyPerUserCafe(0);
    }

    function test_pause_ownerOnly() public {
        consumptionLog.pause();
        assertTrue(consumptionLog.paused());
        consumptionLog.unpause();
        assertFalse(consumptionLog.paused());

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        consumptionLog.pause();
    }
}
