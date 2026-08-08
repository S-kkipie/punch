// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {CafeRegistry, ZeroAddress, CafeNotFound, InvalidStatusTransition} from "../src/CafeRegistry.sol";
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
}
