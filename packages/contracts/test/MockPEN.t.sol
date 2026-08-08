// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MockPEN, FaucetCapExceeded} from "../src/MockPEN.sol";
import {IMockPEN} from "../src/interfaces/IMockPEN.sol";

contract MockPENTest is Test {
    MockPEN internal pen;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        pen = new MockPEN();
    }

    function test_metadata() public view {
        assertEq(pen.decimals(), 6);
        assertEq(pen.name(), "Mock PEN");
        assertEq(pen.symbol(), "mPEN");
    }

    function test_faucet_mintsAndEmits() public {
        vm.expectEmit(true, false, false, true);
        emit IMockPEN.FaucetDripped(alice, 49_000000);
        vm.prank(alice);
        pen.faucet(49_000000);
        assertEq(pen.balanceOf(alice), 49_000000);
    }

    function test_faucet_atCapSucceeds() public {
        uint256 max = pen.FAUCET_MAX();
        vm.prank(alice);
        pen.faucet(max);
        assertEq(pen.balanceOf(alice), max);
    }

    function test_faucet_aboveCapReverts() public {
        uint256 max = pen.FAUCET_MAX();
        uint256 amount = max + 1;
        vm.expectRevert(abi.encodeWithSelector(FaucetCapExceeded.selector, amount, max));
        vm.prank(alice);
        pen.faucet(amount);
    }

    function test_mint_ownerCreditsTarget() public {
        pen.mint(bob, 5_000000);
        assertEq(pen.balanceOf(bob), 5_000000);
    }

    function test_mint_nonOwnerReverts() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vm.prank(alice);
        pen.mint(alice, 1);
    }

    function test_transfer_works() public {
        vm.prank(alice);
        pen.faucet(10_000000);
        vm.prank(alice);
        pen.transfer(bob, 4_000000);
        assertEq(pen.balanceOf(alice), 6_000000);
        assertEq(pen.balanceOf(bob), 4_000000);
    }
}
