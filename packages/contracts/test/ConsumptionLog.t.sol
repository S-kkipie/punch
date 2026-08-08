// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {
    ConsumptionLog,
    ZeroAddress,
    InvalidLimit,
    InvalidUser,
    ProofExpired,
    ExpiryTooFar,
    TicketTooSmall,
    ProductNotEligible,
    InvalidCafeSignature,
    InvalidUserSignature,
    NonceUsed,
    ReceiptUsed,
    DailyLimitReached
} from "../src/ConsumptionLog.sol";
import {PlanManager, PlanNotActive} from "../src/PlanManager.sol";
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

/// @dev Minimal EIP-1271 smart account: approves a fixed digest, rejects everything else.
/// Stands in for the post-MVP passkey / account-abstraction user (mother spec §20).
contract MockSmartAccount is IERC1271 {
    bytes32 public approvedDigest;

    function approve(bytes32 digest) external {
        approvedDigest = digest;
    }

    function isValidSignature(bytes32 digest, bytes memory) external view returns (bytes4) {
        return digest == approvedDigest ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
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

    function test_recordConsumption_pausedReverts() public {
        consumptionLog.pause();
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        consumptionLog.recordConsumption(proof, "", "");
    }

    function test_recordConsumption_zeroUserReverts() public {
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        proof.user = address(0);
        vm.expectRevert(InvalidUser.selector);
        consumptionLog.recordConsumption(proof, "", "");
    }

    function test_recordConsumption_expiredReverts() public {
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        vm.warp(proof.expiry + 1);
        vm.expectRevert(abi.encodeWithSelector(ProofExpired.selector, proof.expiry));
        consumptionLog.recordConsumption(proof, "", "");
    }

    function test_recordConsumption_expiryTooFarReverts() public {
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        proof.expiry = block.timestamp + 16 minutes;
        vm.expectRevert(abi.encodeWithSelector(ExpiryTooFar.selector, proof.expiry));
        consumptionLog.recordConsumption(proof, "", "");
    }

    function test_recordConsumption_ticketTooSmallReverts() public {
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        proof.amount = 8e6 - 1;
        vm.expectRevert(abi.encodeWithSelector(TicketTooSmall.selector, proof.amount));
        consumptionLog.recordConsumption(proof, "", "");
    }

    function test_recordConsumption_productNotEligibleReverts() public {
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        proof.productId = 99;
        vm.expectRevert(abi.encodeWithSelector(ProductNotEligible.selector, cafeId, uint256(99)));
        consumptionLog.recordConsumption(proof, "", "");
    }

    function test_recordConsumption_rewardProductNotEligibleForEmission() public {
        vm.prank(cafeOwner);
        registry.setEligibleProduct(cafeId, 42, ICafeRegistry.ProductKind.Reward, true);
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        proof.productId = 42;
        vm.expectRevert(abi.encodeWithSelector(ProductNotEligible.selector, cafeId, uint256(42)));
        consumptionLog.recordConsumption(proof, "", "");
    }

    function testFuzz_recordConsumption_amountBelowFloorAlwaysReverts(uint256 amount) public {
        amount = bound(amount, 0, 8e6 - 1);
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        proof.amount = amount;
        vm.expectRevert(abi.encodeWithSelector(TicketTooSmall.selector, amount));
        consumptionLog.recordConsumption(proof, "", "");
    }

    function testFuzz_recordConsumption_expiryBeyondTtlAlwaysReverts(uint256 offset) public {
        offset = bound(offset, 15 minutes + 1, 365 days);
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        proof.expiry = block.timestamp + offset;
        vm.expectRevert(abi.encodeWithSelector(ExpiryTooFar.selector, proof.expiry));
        consumptionLog.recordConsumption(proof, "", "");
    }

    function _sign(uint256 privateKey, IConsumptionLog.ConsumptionProof memory proof)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = consumptionLog.hashProof(proof);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_recordConsumption_badCafeSignatureReverts() public {
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        (, uint256 strangerKey) = makeAddrAndKey("strangerSigner");
        bytes memory cafeSig = _sign(strangerKey, proof);
        bytes memory userSig = _sign(userKey, proof);
        vm.expectRevert(InvalidCafeSignature.selector);
        consumptionLog.recordConsumption(proof, cafeSig, userSig);
    }

    function test_recordConsumption_revokedOperatorReverts() public {
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        bytes memory cafeSig = _sign(operatorKey, proof);
        bytes memory userSig = _sign(userKey, proof);

        vm.prank(cafeOwner);
        registry.authorizeOperator(cafeId, operator, false);

        vm.expectRevert(InvalidCafeSignature.selector);
        consumptionLog.recordConsumption(proof, cafeSig, userSig);
    }

    function test_recordConsumption_badUserSignatureReverts() public {
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        (, uint256 otherKey) = makeAddrAndKey("otherUser");
        bytes memory cafeSig = _sign(operatorKey, proof);
        bytes memory userSig = _sign(otherKey, proof);
        vm.expectRevert(InvalidUserSignature.selector);
        consumptionLog.recordConsumption(proof, cafeSig, userSig);
    }

    function test_recordConsumption_mutatedProofReverts() public {
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        bytes memory cafeSig = _sign(operatorKey, proof);
        bytes memory userSig = _sign(userKey, proof);
        proof.amount = 50e6; // raised after both parties signed
        vm.expectRevert(InvalidCafeSignature.selector);
        consumptionLog.recordConsumption(proof, cafeSig, userSig);
    }

    function test_recordConsumption_eip1271UserRejected() public {
        MockSmartAccount account = new MockSmartAccount();
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        proof.user = address(account);
        // No approve call: the account rejects the digest.
        bytes memory cafeSig = _sign(operatorKey, proof);
        vm.expectRevert(InvalidUserSignature.selector);
        consumptionLog.recordConsumption(proof, cafeSig, "");
    }

    function test_recordConsumption_cafeOwnerSignatureAccepted() public {
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        (address ownerSigner, uint256 ownerKey) = makeAddrAndKey("cafeOwnerSigner");
        vm.prank(registrar);
        uint256 otherCafe = registry.registerCafe(ownerSigner);
        vm.prank(registrar);
        registry.setCafeStatus(otherCafe, ICafeRegistry.CafeStatus.Active);
        vm.prank(ownerSigner);
        registry.setEligibleProduct(otherCafe, PRODUCT_ID, ICafeRegistry.ProductKind.Emission, true);

        proof.cafeId = otherCafe;
        bytes memory cafeSig = _sign(ownerKey, proof);
        bytes memory userSig = _sign(userKey, proof);
        // Signatures pass; PlanManager stops it because that café never subscribed.
        vm.expectRevert(abi.encodeWithSelector(PlanNotActive.selector, otherCafe));
        consumptionLog.recordConsumption(proof, cafeSig, userSig);
    }

    function test_recordConsumption_eip1271UserAccepted() public {
        MockSmartAccount account = new MockSmartAccount();
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        proof.user = address(account);
        account.approve(consumptionLog.hashProof(proof));

        bytes memory cafeSig = _sign(operatorKey, proof);
        consumptionLog.recordConsumption(proof, cafeSig, "");

        assertEq(vault.issueCount(), 1);
        assertEq(vault.lastUser(), address(account));
    }

    function test_recordConsumption_malformedCafeSignatureReverts() public {
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        bytes memory userSig = _sign(userKey, proof);

        vm.expectRevert(InvalidCafeSignature.selector);
        consumptionLog.recordConsumption(proof, hex"1234", userSig);
    }

    function _record(uint256 nonce) internal returns (IConsumptionLog.ConsumptionProof memory proof) {
        proof = _proof(nonce);
        bytes memory cafeSig = _sign(operatorKey, proof);
        bytes memory userSig = _sign(userKey, proof);
        consumptionLog.recordConsumption(proof, cafeSig, userSig);
    }

    function test_recordConsumption_happyPath() public {
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        bytes memory cafeSig = _sign(operatorKey, proof);
        bytes memory userSig = _sign(userKey, proof);

        uint256 creditsBefore = manager.credits(cafeId);
        uint256 vaultPenBefore = pen.balanceOf(address(vault));

        vm.expectEmit(true, true, true, false);
        emit IConsumptionLog.ConsumptionRecorded(cafeId, user, proof.receiptHash);
        vm.prank(stranger); // permissionless relayer
        consumptionLog.recordConsumption(proof, cafeSig, userSig);

        assertEq(vault.issueCount(), 1);
        assertEq(vault.lastUser(), user);
        assertEq(vault.lastCafeId(), cafeId);
        assertEq(manager.credits(cafeId), creditsBefore - 1);
        assertEq(pen.balanceOf(address(vault)) - vaultPenBefore, 300_000);
        assertTrue(consumptionLog.nonceUsed(cafeId, 1));
        assertTrue(consumptionLog.receiptUsed(cafeId, proof.receiptHash));
    }

    function test_recordConsumption_expiryAtDeadlineStillValid() public {
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        bytes memory cafeSig = _sign(operatorKey, proof);
        bytes memory userSig = _sign(userKey, proof);

        vm.warp(proof.expiry); // exactly at the deadline: inclusive, still valid
        consumptionLog.recordConsumption(proof, cafeSig, userSig);

        assertEq(vault.issueCount(), 1);
    }

    function test_recordConsumption_replaySameProofReverts() public {
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        bytes memory cafeSig = _sign(operatorKey, proof);
        bytes memory userSig = _sign(userKey, proof);
        consumptionLog.recordConsumption(proof, cafeSig, userSig);

        vm.expectRevert(abi.encodeWithSelector(NonceUsed.selector, cafeId, uint256(1)));
        consumptionLog.recordConsumption(proof, cafeSig, userSig);
    }

    function test_recordConsumption_reusedReceiptWithNewNonceReverts() public {
        IConsumptionLog.ConsumptionProof memory first = _record(1);

        IConsumptionLog.ConsumptionProof memory proof = _proof(2);
        proof.receiptHash = first.receiptHash;
        bytes memory cafeSig = _sign(operatorKey, proof);
        bytes memory userSig = _sign(userKey, proof);

        vm.expectRevert(abi.encodeWithSelector(ReceiptUsed.selector, cafeId, first.receiptHash));
        consumptionLog.recordConsumption(proof, cafeSig, userSig);
    }

    function test_recordConsumption_noncesAreOutOfOrder() public {
        _record(500);
        _record(3);
        _record(42);
        assertEq(vault.issueCount(), 3);
    }

    function test_recordConsumption_nonceAndReceiptScopedPerCafe() public {
        IConsumptionLog.ConsumptionProof memory first = _record(1);

        // A second café reusing the exact same nonce and receiptHash must succeed.
        (address otherOperator, uint256 otherOperatorKey) = makeAddrAndKey("otherOperator");
        vm.prank(registrar);
        uint256 otherCafe = registry.registerCafe(cafeOwner);
        vm.prank(registrar);
        registry.setCafeStatus(otherCafe, ICafeRegistry.CafeStatus.Active);
        vm.startPrank(cafeOwner);
        registry.authorizeOperator(otherCafe, otherOperator, true);
        registry.setEligibleProduct(otherCafe, PRODUCT_ID, ICafeRegistry.ProductKind.Emission, true);
        manager.subscribe(otherCafe);
        vm.stopPrank();

        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        proof.cafeId = otherCafe;
        proof.receiptHash = first.receiptHash;
        bytes memory cafeSig = _sign(otherOperatorKey, proof);
        bytes memory userSig = _sign(userKey, proof);
        consumptionLog.recordConsumption(proof, cafeSig, userSig);

        assertEq(vault.issueCount(), 2);
    }

    function test_recordConsumption_vaultRevertRollsBackCredit() public {
        vault.setShouldRevert(true);
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        bytes memory cafeSig = _sign(operatorKey, proof);
        bytes memory userSig = _sign(userKey, proof);

        uint256 creditsBefore = manager.credits(cafeId);
        vm.expectRevert(MockPunchVault.MockVaultReverted.selector);
        consumptionLog.recordConsumption(proof, cafeSig, userSig);

        assertEq(manager.credits(cafeId), creditsBefore);
        assertFalse(consumptionLog.nonceUsed(cafeId, 1));
        assertFalse(consumptionLog.receiptUsed(cafeId, proof.receiptHash));
    }

    function test_recordConsumption_dailyCapBlocksFourth() public {
        _record(1);
        _record(2);
        _record(3);

        IConsumptionLog.ConsumptionProof memory proof = _proof(4);
        bytes memory cafeSig = _sign(operatorKey, proof);
        bytes memory userSig = _sign(userKey, proof);
        vm.expectRevert(abi.encodeWithSelector(DailyLimitReached.selector, cafeId, user));
        consumptionLog.recordConsumption(proof, cafeSig, userSig);

        assertEq(consumptionLog.dailyCount(cafeId, user, block.timestamp / 1 days), 3);
        assertEq(vault.issueCount(), 3);
    }

    function test_recordConsumption_dailyCapResetsNextDay() public {
        _record(1);
        _record(2);
        _record(3);

        vm.warp(block.timestamp + 1 days);
        _record(4);
        assertEq(vault.issueCount(), 4);
    }

    function test_recordConsumption_dailyCapIsPerCafe() public {
        _record(1);
        _record(2);
        _record(3);

        (address otherOperator, uint256 otherOperatorKey) = makeAddrAndKey("otherOperator2");
        vm.prank(registrar);
        uint256 otherCafe = registry.registerCafe(cafeOwner);
        vm.prank(registrar);
        registry.setCafeStatus(otherCafe, ICafeRegistry.CafeStatus.Active);
        vm.startPrank(cafeOwner);
        registry.authorizeOperator(otherCafe, otherOperator, true);
        registry.setEligibleProduct(otherCafe, PRODUCT_ID, ICafeRegistry.ProductKind.Emission, true);
        manager.subscribe(otherCafe);
        vm.stopPrank();

        IConsumptionLog.ConsumptionProof memory proof = _proof(10);
        proof.cafeId = otherCafe;
        bytes memory cafeSig = _sign(otherOperatorKey, proof);
        bytes memory userSig = _sign(userKey, proof);
        consumptionLog.recordConsumption(proof, cafeSig, userSig);

        assertEq(vault.issueCount(), 4);
    }

    function test_recordConsumption_dailyCapIsPerUser() public {
        _record(1);
        _record(2);
        _record(3);

        (address otherUser, uint256 otherUserKey) = makeAddrAndKey("otherUser2");
        IConsumptionLog.ConsumptionProof memory proof = _proof(11);
        proof.user = otherUser;
        bytes memory cafeSig = _sign(operatorKey, proof);
        bytes memory userSig = _sign(otherUserKey, proof);
        consumptionLog.recordConsumption(proof, cafeSig, userSig);

        assertEq(vault.issueCount(), 4);
    }

    function test_recordConsumption_raisedCapTakesEffect() public {
        _record(1);
        _record(2);
        _record(3);
        consumptionLog.setMaxDailyPerUserCafe(4);
        _record(4);
        assertEq(vault.issueCount(), 4);
    }

    function test_recordConsumption_planCancelledReverts() public {
        vm.prank(cafeOwner);
        manager.cancel(cafeId);

        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        bytes memory cafeSig = _sign(operatorKey, proof);
        bytes memory userSig = _sign(userKey, proof);
        vm.expectRevert(abi.encodeWithSelector(PlanNotActive.selector, cafeId));
        consumptionLog.recordConsumption(proof, cafeSig, userSig);
    }
}
