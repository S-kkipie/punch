// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PlanManager} from "../src/PlanManager.sol";
import {ICafeRegistry} from "../src/interfaces/ICafeRegistry.sol";

contract DeployPlanManager is Script {
    function run() external returns (PlanManager manager) {
        IERC20 pen = IERC20(vm.envAddress("PEN_ADDRESS"));
        ICafeRegistry registry = ICafeRegistry(vm.envAddress("CAFE_REGISTRY_ADDRESS"));
        address vault = vm.envAddress("PUNCH_VAULT_ADDRESS");
        address networkFund = vm.envAddress("NETWORK_FUND_ADDRESS");
        address treasury = vm.envAddress("TREASURY_ADDRESS");

        vm.startBroadcast();
        manager = new PlanManager(pen, registry, vault, networkFund, treasury);
        vm.stopBroadcast();
    }
}
