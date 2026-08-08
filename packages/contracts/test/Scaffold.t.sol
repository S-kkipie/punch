// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {NotImplemented} from "../src/NotImplemented.sol";
import {PunchVault} from "../src/PunchVault.sol";
import {NetworkFund} from "../src/NetworkFund.sol";
import {CampaignEscrow} from "../src/CampaignEscrow.sol";
import {MockPEN} from "../src/MockPEN.sol";

contract ScaffoldTest is Test {
    PunchVault internal punchVault;
    NetworkFund internal networkFund;
    CampaignEscrow internal campaignEscrow;
    MockPEN internal mockPEN;

    function setUp() public {
        punchVault = new PunchVault();
        networkFund = new NetworkFund();
        campaignEscrow = new CampaignEscrow();
        mockPEN = new MockPEN();
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
