// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {NotImplemented} from "../src/NotImplemented.sol";
import {CafeRegistry} from "../src/CafeRegistry.sol";
import {PlanManager} from "../src/PlanManager.sol";
import {ConsumptionLog} from "../src/ConsumptionLog.sol";
import {PunchVault} from "../src/PunchVault.sol";
import {NetworkFund} from "../src/NetworkFund.sol";
import {CampaignEscrow} from "../src/CampaignEscrow.sol";
import {MockPEN} from "../src/MockPEN.sol";
import {IConsumptionLog} from "../src/interfaces/IConsumptionLog.sol";
import {ICafeRegistry} from "../src/interfaces/ICafeRegistry.sol";

contract ScaffoldTest is Test {
    CafeRegistry internal cafeRegistry;
    PlanManager internal planManager;
    ConsumptionLog internal consumptionLog;
    PunchVault internal punchVault;
    NetworkFund internal networkFund;
    CampaignEscrow internal campaignEscrow;
    MockPEN internal mockPEN;

    function setUp() public {
        cafeRegistry = new CafeRegistry();
        planManager = new PlanManager();
        consumptionLog = new ConsumptionLog();
        punchVault = new PunchVault();
        networkFund = new NetworkFund();
        campaignEscrow = new CampaignEscrow();
        mockPEN = new MockPEN();
    }

    function test_cafeRegistry_reverts_notImplemented() public {
        vm.expectRevert(NotImplemented.selector);
        cafeRegistry.registerCafe(address(this));
        vm.expectRevert(NotImplemented.selector);
        cafeRegistry.setCafeStatus(1, ICafeRegistry.CafeStatus.Active);
        vm.expectRevert(NotImplemented.selector);
        cafeRegistry.authorizeOperator(1, address(this), true);
        vm.expectRevert(NotImplemented.selector);
        cafeRegistry.setEligibleProduct(1, 1, ICafeRegistry.ProductKind.Emission, true);
    }

    function test_planManager_reverts_notImplemented() public {
        vm.expectRevert(NotImplemented.selector);
        planManager.subscribe(1);
        vm.expectRevert(NotImplemented.selector);
        planManager.buyPack(1);
        vm.expectRevert(NotImplemented.selector);
        planManager.consumeCredit(1);
        vm.expectRevert(NotImplemented.selector);
        planManager.cancel(1);
        vm.expectRevert(NotImplemented.selector);
        planManager.withdrawUnusedReserve(1);
    }

    function test_consumptionLog_reverts_notImplemented() public {
        IConsumptionLog.ConsumptionProof memory proof;
        vm.expectRevert(NotImplemented.selector);
        consumptionLog.recordConsumption(proof, "", "");
    }

    function test_punchVault_reverts_notImplemented() public {
        vm.expectRevert(NotImplemented.selector);
        punchVault.issue(address(this), 1);
        vm.expectRevert(NotImplemented.selector);
        punchVault.redeem(address(this), 1, 1);
        vm.expectRevert(NotImplemented.selector);
        punchVault.balanceOf(address(this));
    }

    function test_networkFund_reverts_notImplemented() public {
        vm.expectRevert(NotImplemented.selector);
        networkFund.fundEpoch(1, 1);
        vm.expectRevert(NotImplemented.selector);
        networkFund.recordReferral(1, 1);
        vm.expectRevert(NotImplemented.selector);
        networkFund.finalizeOriginEpoch(1);
        vm.expectRevert(NotImplemented.selector);
        networkFund.claimOriginCredit(1, 1);
        vm.expectRevert(NotImplemented.selector);
        networkFund.allocateCampaignBudget(1, 1);
    }

    function test_campaignEscrow_reverts_notImplemented() public {
        vm.expectRevert(NotImplemented.selector);
        campaignEscrow.createCampaign(1);
        vm.expectRevert(NotImplemented.selector);
        campaignEscrow.fundCampaign(1, 1);
        vm.expectRevert(NotImplemented.selector);
        campaignEscrow.recordProgress(1, address(this));
        vm.expectRevert(NotImplemented.selector);
        campaignEscrow.unlockVoucher(1, address(this));
        vm.expectRevert(NotImplemented.selector);
        campaignEscrow.redeemVoucher(1, address(this));
        vm.expectRevert(NotImplemented.selector);
        campaignEscrow.cancelUnpublishedCampaign(1);
    }
}
