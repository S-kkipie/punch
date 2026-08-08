// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {
    CafeRegistry,
    ZeroAddress,
    CafeNotFound,
    InvalidStatusTransition,
    NotCafeOwner,
    CafeNotConfigurable,
    NoStateChange,
    NotPendingOwner
} from "../src/CafeRegistry.sol";
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
        vm.startPrank(admin);
        registry.grantRole(registry.REGISTRAR_ROLE(), registrar);
        vm.stopPrank();
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

    function test_revokeRegistrarRoleStopsRegistrarWrites() public {
        address compromised = makeAddr("compromised");
        bytes32 registrarRole = registry.REGISTRAR_ROLE();
        vm.startPrank(admin);
        registry.grantRole(registrarRole, compromised);
        vm.stopPrank();

        vm.prank(compromised);
        uint256 cafeId = registry.registerCafe(owner1);
        vm.prank(compromised);
        registry.setCafeStatus(cafeId, ICafeRegistry.CafeStatus.Active);

        vm.prank(admin);
        registry.revokeRole(registrarRole, compromised);

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, compromised, registrarRole)
        );
        vm.prank(compromised);
        registry.registerCafe(owner2);

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, compromised, registrarRole)
        );
        vm.prank(compromised);
        registry.setCafeStatus(cafeId, ICafeRegistry.CafeStatus.Suspended);
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
                    vm.expectRevert(abi.encodeWithSelector(InvalidStatusTransition.selector, fromStatus, toStatus));
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

    function test_authorizeOperator_ownerSelfAuthorizationReverts() public {
        uint256 cafeId = _register(owner1);
        vm.expectRevert(NoStateChange.selector);
        vm.prank(owner1);
        registry.authorizeOperator(cafeId, owner1, true);
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
            abi.encodeWithSelector(CafeNotConfigurable.selector, cafeId, ICafeRegistry.CafeStatus.Suspended)
        );
        vm.prank(owner1);
        registry.authorizeOperator(cafeId, operator, true);
    }

    function test_authorizeOperator_exitedCafeReverts() public {
        uint256 cafeId = _register(owner1);
        _setStatus(cafeId, ICafeRegistry.CafeStatus.Exited);
        vm.expectRevert(abi.encodeWithSelector(CafeNotConfigurable.selector, cafeId, ICafeRegistry.CafeStatus.Exited));
        vm.prank(owner1);
        registry.authorizeOperator(cafeId, operator, true);
    }

    function test_setEligibleProduct_approvesAndEmits() public {
        uint256 cafeId = _register(owner1);
        vm.expectEmit(true, true, false, true);
        emit ICafeRegistry.ProductEligibilityChanged(cafeId, 47, ICafeRegistry.ProductKind.Emission, true);
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
            abi.encodeWithSelector(CafeNotConfigurable.selector, cafeId, ICafeRegistry.CafeStatus.Suspended)
        );
        vm.prank(owner1);
        registry.setEligibleProduct(cafeId, 47, ICafeRegistry.ProductKind.Emission, true);
    }

    function test_setEligibleProduct_exitedCafeReverts() public {
        uint256 cafeId = _register(owner1);
        _setStatus(cafeId, ICafeRegistry.CafeStatus.Exited);
        vm.expectRevert(abi.encodeWithSelector(CafeNotConfigurable.selector, cafeId, ICafeRegistry.CafeStatus.Exited));
        vm.prank(owner1);
        registry.setEligibleProduct(cafeId, 47, ICafeRegistry.ProductKind.Emission, true);
    }

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

    function test_acceptOwnership_clearsOperatorBitFromOutgoingOwner() public {
        uint256 cafeId = _register(owner1);
        vm.startPrank(owner1);
        registry.authorizeOperator(cafeId, owner2, true);
        registry.proposeOwner(cafeId, owner2);
        vm.stopPrank();

        vm.prank(owner2);
        registry.acceptOwnership(cafeId);
        assertTrue(registry.isAuthorized(cafeId, owner2));

        vm.prank(owner2);
        registry.proposeOwner(cafeId, stranger);
        vm.prank(stranger);
        registry.acceptOwnership(cafeId);
        assertFalse(registry.isAuthorized(cafeId, owner2));
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

    function test_acceptOwnership_exitedCafeRevertsAndClearsPendingOwner() public {
        uint256 cafeId = _register(owner1);
        vm.prank(owner1);
        registry.proposeOwner(cafeId, owner2);

        _setStatus(cafeId, ICafeRegistry.CafeStatus.Exited);

        vm.expectRevert(abi.encodeWithSelector(CafeNotConfigurable.selector, cafeId, ICafeRegistry.CafeStatus.Exited));
        vm.prank(owner2);
        registry.acceptOwnership(cafeId);

        bytes32 cafeStorage = keccak256(abi.encode(cafeId, uint256(0)));
        assertEq(vm.load(address(registry), bytes32(uint256(cafeStorage) + 1)), bytes32(0));
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
        vm.expectRevert(abi.encodeWithSelector(CafeNotConfigurable.selector, cafeId, ICafeRegistry.CafeStatus.Exited));
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

    function testFuzz_setEligibleProduct_reflectsLastWrite(uint256 productId, bool firstEligible, bool secondEligible)
        public
    {
        uint256 cafeId = _register(owner1);
        bool finalEligible;

        if (firstEligible) {
            vm.prank(owner1);
            registry.setEligibleProduct(cafeId, productId, ICafeRegistry.ProductKind.Emission, true);
            finalEligible = true;
        }

        if (secondEligible != finalEligible) {
            vm.prank(owner1);
            registry.setEligibleProduct(cafeId, productId, ICafeRegistry.ProductKind.Emission, secondEligible);
            finalEligible = secondEligible;
        }

        assertEq(registry.isEligible(cafeId, productId, ICafeRegistry.ProductKind.Emission), finalEligible);
        assertFalse(registry.isEligible(cafeId, productId, ICafeRegistry.ProductKind.Reward));
    }
}
