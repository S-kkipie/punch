// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CampaignEscrow} from "../src/CampaignEscrow.sol";
import {ICafeRegistry} from "../src/interfaces/ICafeRegistry.sol";

contract DeployCampaignEscrow is Script {
    function run() external returns (CampaignEscrow escrow) {
        IERC20 pen = IERC20(vm.envAddress("PEN_ADDRESS"));
        ICafeRegistry registry = ICafeRegistry(vm.envAddress("CAFE_REGISTRY_ADDRESS"));

        vm.startBroadcast();
        escrow = new CampaignEscrow(pen, registry);
        vm.stopBroadcast();
    }
}
