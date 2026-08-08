// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {CafeRegistry, ZeroAddress, CafeNotFound} from "../src/CafeRegistry.sol";
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
}
