// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {ConsumptionLog} from "../src/ConsumptionLog.sol";
import {ICafeRegistry} from "../src/interfaces/ICafeRegistry.sol";
import {IPlanManager} from "../src/interfaces/IPlanManager.sol";
import {IPunchVault} from "../src/interfaces/IPunchVault.sol";

/// @notice Deploys ConsumptionLog. Emission stays off until the PlanManager owner runs
/// `planManager.setConsumptionLog(address(consumptionLog))` — a separate transaction this script
/// deliberately does not send, since the broadcaster is not necessarily that owner.
contract DeployConsumptionLog is Script {
    function run() external returns (ConsumptionLog consumptionLog) {
        ICafeRegistry registry = ICafeRegistry(vm.envAddress("CAFE_REGISTRY_ADDRESS"));
        IPlanManager planManager = IPlanManager(vm.envAddress("PLAN_MANAGER_ADDRESS"));
        IPunchVault punchVault = IPunchVault(vm.envAddress("PUNCH_VAULT_ADDRESS"));

        vm.startBroadcast();
        consumptionLog = new ConsumptionLog(registry, planManager, punchVault);
        vm.stopBroadcast();
    }
}
