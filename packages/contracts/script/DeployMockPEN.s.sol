// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {MockPEN} from "../src/MockPEN.sol";

contract DeployMockPEN is Script {
    function run() external returns (MockPEN pen) {
        vm.startBroadcast();
        pen = new MockPEN();
        vm.stopBroadcast();
    }
}
