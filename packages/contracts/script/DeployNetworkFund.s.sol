// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NetworkFund} from "../src/NetworkFund.sol";
import {ICafeRegistry} from "../src/interfaces/ICafeRegistry.sol";

contract DeployNetworkFund is Script {
    function run() external returns (NetworkFund fund) {
        IERC20 pen = IERC20(vm.envAddress("PEN_ADDRESS"));
        ICafeRegistry registry = ICafeRegistry(vm.envAddress("CAFE_REGISTRY_ADDRESS"));

        vm.startBroadcast();
        fund = new NetworkFund(pen, registry);
        vm.stopBroadcast();
    }
}
