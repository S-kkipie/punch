// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {NotImplemented} from "../src/NotImplemented.sol";
import {CampaignEscrow} from "../src/CampaignEscrow.sol";
import {MockPEN} from "../src/MockPEN.sol";

contract ScaffoldTest is Test {
    CampaignEscrow internal campaignEscrow;
    MockPEN internal mockPEN;

    function setUp() public {
        campaignEscrow = new CampaignEscrow();
        mockPEN = new MockPEN();
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
