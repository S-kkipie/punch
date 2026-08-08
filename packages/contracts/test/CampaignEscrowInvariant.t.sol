// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CampaignEscrow} from "../src/CampaignEscrow.sol";
import {CafeRegistry} from "../src/CafeRegistry.sol";
import {MockPEN} from "../src/MockPEN.sol";
import {ICafeRegistry} from "../src/interfaces/ICafeRegistry.sol";

/// @dev Random-action handler. Owns the escrow (deployer) and acts as operator and
/// funder. Tracks ghost totals for outflows so the invariants can check conservation.
contract CampaignEscrowHandler is Test {
    MockPEN public pen;
    CafeRegistry public registry;
    CampaignEscrow public escrow;

    address public cafeOwner = makeAddr("cafeOwner");
    address[] public users;
    uint256[] public campaignIds;

    uint256 public cafeId;
    uint256 public ghostPaidOut; // redeems + refunds + recoveries

    uint256 internal constant MAX_PAYOUT = 10_000_000;

    constructor(MockPEN pen_, CafeRegistry registry_, CampaignEscrow escrow_, uint256 cafeId_) {
        pen = pen_;
        registry = registry_;
        escrow = escrow_;
        cafeId = cafeId_;
        for (uint256 i = 0; i < 5; i++) {
            users.push(makeAddr(string(abi.encodePacked("user", vm.toString(i)))));
        }
    }

    function createAndFund(uint256 amountSeed) external {
        uint256 amount = bound(amountSeed, 1, 50_000_000);
        uint256 id = escrow.createCampaign(cafeId);
        campaignIds.push(id);
        pen.mint(address(this), amount);
        pen.approve(address(escrow), amount);
        escrow.fundCampaign(id, amount);
    }

    function donateAndAssign(uint256 amountSeed, uint256 idSeed) external {
        if (campaignIds.length == 0) return;
        uint256 amount = bound(amountSeed, 1, 50_000_000);
        uint256 id = campaignIds[bound(idSeed, 0, campaignIds.length - 1)];
        pen.mint(address(escrow), amount); // simulates allocateCampaignBudget
        if (uint8(escrow.campaigns(id).status) != uint8(CampaignEscrow.CampaignStatus.Draft)) {
            return; // free balance stays free — donations only raise coverage
        }
        escrow.assignBudget(id, amount);
    }

    function publish(uint256 idSeed, uint256 payoutSeed, uint256 maxSeed) external {
        if (campaignIds.length == 0) return;
        uint256 id = campaignIds[bound(idSeed, 0, campaignIds.length - 1)];
        CampaignEscrow.Campaign memory c = escrow.campaigns(id);
        if (uint8(c.status) != uint8(CampaignEscrow.CampaignStatus.Draft)) return;
        uint256 payout = bound(payoutSeed, 1, MAX_PAYOUT);
        uint256 maxV = bound(maxSeed, 1, 4);
        if (c.budget < payout * maxV) return;
        escrow.publishCampaign(id, payout, maxV, block.timestamp + 30 days);
    }

    function unlock(uint256 idSeed, uint256 userSeed) external {
        if (campaignIds.length == 0) return;
        uint256 id = campaignIds[bound(idSeed, 0, campaignIds.length - 1)];
        CampaignEscrow.Campaign memory c = escrow.campaigns(id);
        if (uint8(c.status) != uint8(CampaignEscrow.CampaignStatus.Published)) return;
        if (block.timestamp > c.expiry) return;
        if (c.unlockedCount >= c.maxVouchers) return;
        address user = users[bound(userSeed, 0, users.length - 1)];
        if (uint8(escrow.voucherState(id, user)) != uint8(CampaignEscrow.VoucherState.None)) {
            return;
        }
        escrow.unlockVoucher(id, user);
    }

    function redeem(uint256 idSeed, uint256 userSeed) external {
        if (campaignIds.length == 0) return;
        uint256 id = campaignIds[bound(idSeed, 0, campaignIds.length - 1)];
        CampaignEscrow.Campaign memory c = escrow.campaigns(id);
        if (uint8(c.status) != uint8(CampaignEscrow.CampaignStatus.Published)) return;
        if (block.timestamp > c.expiry) return;
        address user = users[bound(userSeed, 0, users.length - 1)];
        if (uint8(escrow.voucherState(id, user)) != uint8(CampaignEscrow.VoucherState.Unlocked)) {
            return;
        }
        escrow.redeemVoucher(id, user);
        ghostPaidOut += c.voucherPayout;
    }

    function cancel(uint256 idSeed) external {
        if (campaignIds.length == 0) return;
        uint256 id = campaignIds[bound(idSeed, 0, campaignIds.length - 1)];
        CampaignEscrow.Campaign memory c = escrow.campaigns(id);
        if (uint8(c.status) != uint8(CampaignEscrow.CampaignStatus.Draft)) return;
        escrow.cancelUnpublishedCampaign(id);
        ghostPaidOut += c.budget;
    }

    function warpAndRecover(uint256 idSeed) external {
        if (campaignIds.length == 0) return;
        uint256 id = campaignIds[bound(idSeed, 0, campaignIds.length - 1)];
        CampaignEscrow.Campaign memory c = escrow.campaigns(id);
        if (uint8(c.status) != uint8(CampaignEscrow.CampaignStatus.Published)) return;
        if (c.budget == 0) return;
        vm.warp(c.expiry + 1);
        escrow.recoverExpiredBudget(id);
        ghostPaidOut += c.budget;
    }

    function campaignCount() external view returns (uint256) {
        return campaignIds.length;
    }

    function campaignIdAt(uint256 i) external view returns (uint256) {
        return campaignIds[i];
    }
}

contract CampaignEscrowInvariantTest is Test {
    MockPEN internal pen;
    CafeRegistry internal registry;
    CampaignEscrow internal escrow;
    CampaignEscrowHandler internal handler;

    function setUp() public {
        address admin = makeAddr("admin");
        pen = new MockPEN();
        registry = new CafeRegistry(admin);

        bytes32 registrarRole = registry.REGISTRAR_ROLE();
        vm.prank(admin);
        registry.grantRole(registrarRole, address(this));
        uint256 cafeId = registry.registerCafe(makeAddr("cafeOwner"));
        registry.setCafeStatus(cafeId, ICafeRegistry.CafeStatus.Active);

        escrow = new CampaignEscrow(IERC20(address(pen)), registry);
        handler = new CampaignEscrowHandler(pen, registry, escrow, cafeId);
        // The handler drives owner-gated and operator-gated paths alike.
        escrow.setCampaignOperator(address(handler));
        escrow.transferOwnership(address(handler));

        targetContract(address(handler));
    }

    /// @dev Free balance is never negative: real balance always covers assigned budgets.
    function invariant_balanceCoversAssignedBudget() public view {
        assertGe(pen.balanceOf(address(escrow)), escrow.totalAssignedBudget());
    }

    /// @dev totalAssignedBudget is exactly the sum of per-campaign budgets.
    function invariant_assignedBudgetEqualsSum() public view {
        uint256 sum;
        uint256 n = handler.campaignCount();
        for (uint256 i = 0; i < n; i++) {
            sum += escrow.campaigns(handler.campaignIdAt(i)).budget;
        }
        assertEq(escrow.totalAssignedBudget(), sum);
    }

    /// @dev Published live campaigns never promise more than their budget holds.
    function invariant_publishedCampaignsFullyCovered() public view {
        uint256 n = handler.campaignCount();
        for (uint256 i = 0; i < n; i++) {
            CampaignEscrow.Campaign memory c = escrow.campaigns(handler.campaignIdAt(i));
            if (uint8(c.status) != uint8(CampaignEscrow.CampaignStatus.Published)) continue;
            if (block.timestamp > c.expiry) continue; // expired promises die
            assertGe(c.budget, (c.maxVouchers - c.redeemedCount) * c.voucherPayout);
        }
    }

    /// @dev Conservation: everything minted in equals balance plus everything paid out.
    function invariant_conservation() public view {
        // All inflows were minted either to the handler (then funded) or straight to
        // the escrow (donations/assignments). Outflows are tracked in ghostPaidOut.
        uint256 mintedToEscrowSystem = pen.totalSupply() - pen.balanceOf(address(handler));
        assertEq(mintedToEscrowSystem, pen.balanceOf(address(escrow)) + handler.ghostPaidOut());
    }
}
