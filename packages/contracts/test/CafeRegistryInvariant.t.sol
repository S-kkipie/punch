// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {CafeRegistry} from "../src/CafeRegistry.sol";
import {ICafeRegistry} from "../src/interfaces/ICafeRegistry.sol";

/// @dev Hammers setCafeStatus with arbitrary targets, swallowing reverts, and records
/// whether the café was ever driven to Exited.
contract StatusHandler is Test {
    CafeRegistry public registry;
    uint256 public cafeId;
    bool public everExited;

    constructor(CafeRegistry registry_, uint256 cafeId_) {
        registry = registry_;
        cafeId = cafeId_;
    }

    function poke(uint8 rawStatus) external {
        ICafeRegistry.CafeStatus target = ICafeRegistry.CafeStatus(uint8(bound(uint256(rawStatus), 0, 3)));
        try registry.setCafeStatus(cafeId, target) {
            if (target == ICafeRegistry.CafeStatus.Exited) {
                everExited = true;
            }
        } catch {}
    }
}

contract CafeRegistryInvariantTest is Test {
    CafeRegistry internal registry;
    StatusHandler internal handler;

    address internal admin = makeAddr("admin");
    address internal cafeOwner = makeAddr("cafeOwner");

    function setUp() public {
        registry = new CafeRegistry(admin);

        vm.startPrank(admin);
        registry.grantRole(registry.REGISTRAR_ROLE(), address(this));
        vm.stopPrank();

        uint256 cafeId = registry.registerCafe(cafeOwner);
        handler = new StatusHandler(registry, cafeId);

        vm.startPrank(admin);
        registry.grantRole(registry.REGISTRAR_ROLE(), address(handler));
        vm.stopPrank();

        targetContract(address(handler));
    }

    /// @notice Invariant: once a café reaches Exited it never leaves (spec decision 3).
    function invariant_exitedIsTerminal() public view {
        if (!handler.everExited()) return;
        (, ICafeRegistry.CafeStatus status) = registry.getCafe(handler.cafeId());
        assertEq(uint8(status), uint8(ICafeRegistry.CafeStatus.Exited), unicode"a café left the Exited state");
    }
}
