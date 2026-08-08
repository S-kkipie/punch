// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {NotImplemented} from "../src/NotImplemented.sol";
import {ConsumptionLog} from "../src/ConsumptionLog.sol";
import {PunchVault} from "../src/PunchVault.sol";
import {CampaignEscrow} from "../src/CampaignEscrow.sol";
import {MockPEN} from "../src/MockPEN.sol";
import {IConsumptionLog} from "../src/interfaces/IConsumptionLog.sol";

contract ScaffoldTest is Test {
    ConsumptionLog internal consumptionLog;
    PunchVault internal punchVault;
    CampaignEscrow internal campaignEscrow;
    MockPEN internal mockPEN;

    function setUp() public {
        consumptionLog = new ConsumptionLog();
        punchVault = new PunchVault();
        campaignEscrow = new CampaignEscrow();
        mockPEN = new MockPEN();
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
