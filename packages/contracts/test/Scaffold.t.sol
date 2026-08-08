// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {MockPEN} from "../src/MockPEN.sol";

contract ScaffoldTest is Test {
    MockPEN internal mockPEN;

    function setUp() public {
        mockPEN = new MockPEN();
    }
}
