// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    CampaignEscrow,
    ZeroAddress,
    ZeroAmount,
    CampaignNotFound,
    NotDraft,
    NotPublished,
    NotCampaignOperator,
    CafeNotOperational,
    InsufficientBudget,
    InsufficientFreeBalance,
    ExpiryInPast,
    CampaignExpired,
    CampaignNotExpired,
    VoucherAlreadyUnlocked,
    VoucherNotUnlocked,
    VoucherAlreadyRedeemed,
    MaxVouchersReached,
    NothingToRecover
} from "../src/CampaignEscrow.sol";
import {CafeRegistry} from "../src/CafeRegistry.sol";
import {MockPEN} from "../src/MockPEN.sol";
import {ICafeRegistry} from "../src/interfaces/ICafeRegistry.sol";
import {ICampaignEscrow} from "../src/interfaces/ICampaignEscrow.sol";

contract CampaignEscrowTest is Test {
    MockPEN internal pen;
    CafeRegistry internal registry;
    CampaignEscrow internal escrow;

    address internal admin = makeAddr("admin");
    address internal registrar = makeAddr("registrar");
    address internal cafeOwner = makeAddr("cafeOwner");
    address internal otherOwner = makeAddr("otherOwner");
    address internal operator = makeAddr("operator");
    address internal funder = makeAddr("funder");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal stranger = makeAddr("stranger");

    uint256 internal cafeId;
    uint256 internal otherCafeId;

    uint256 internal constant PAYOUT = 5_000_000; // S/5.00 voucher fulfillment
    uint256 internal constant MAX_VOUCHERS = 3;

    function setUp() public {
        pen = new MockPEN();
        registry = new CafeRegistry(admin);

        // Cache the role before pranking: the view call would consume a vm.prank.
        bytes32 registrarRole = registry.REGISTRAR_ROLE();
        vm.prank(admin);
        registry.grantRole(registrarRole, registrar);

        vm.startPrank(registrar);
        cafeId = registry.registerCafe(cafeOwner);
        registry.setCafeStatus(cafeId, ICafeRegistry.CafeStatus.Active);
        otherCafeId = registry.registerCafe(otherOwner);
        registry.setCafeStatus(otherCafeId, ICafeRegistry.CafeStatus.Active);
        vm.stopPrank();

        escrow = new CampaignEscrow(IERC20(address(pen)), registry);
        escrow.setCampaignOperator(operator);

        pen.mint(funder, 1_000_000_000);
        vm.prank(funder);
        pen.approve(address(escrow), type(uint256).max);
    }

    /// @dev create + fund exactly PAYOUT×MAX_VOUCHERS + publish with 1-day expiry.
    function _publishedCampaign() internal returns (uint256 id) {
        id = escrow.createCampaign(cafeId);
        vm.prank(funder);
        escrow.fundCampaign(id, PAYOUT * MAX_VOUCHERS);
        escrow.publishCampaign(id, PAYOUT, MAX_VOUCHERS, block.timestamp + 1 days);
    }

    // --- constructor ---

    function test_constructor_zeroAddressReverts() public {
        vm.expectRevert(ZeroAddress.selector);
        new CampaignEscrow(IERC20(address(0)), registry);
        vm.expectRevert(ZeroAddress.selector);
        new CampaignEscrow(IERC20(address(pen)), ICafeRegistry(address(0)));
    }

    // --- createCampaign ---

    function test_create_assignsIncrementalIdsFromOne() public {
        vm.expectEmit(true, true, false, true);
        emit ICampaignEscrow.CampaignCreated(1, cafeId);
        uint256 first = escrow.createCampaign(cafeId);
        uint256 second = escrow.createCampaign(otherCafeId);
        assertEq(first, 1);
        assertEq(second, 2);
        CampaignEscrow.Campaign memory c = escrow.campaigns(first);
        assertEq(c.sourceCafeId, cafeId);
        assertEq(uint8(c.status), uint8(CampaignEscrow.CampaignStatus.Draft));
    }

    function test_create_revertsForNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        escrow.createCampaign(cafeId);
    }

    function test_create_revertsForNonOperationalCafe() public {
        vm.prank(registrar);
        registry.setCafeStatus(cafeId, ICafeRegistry.CafeStatus.Suspended);
        vm.expectRevert(abi.encodeWithSelector(CafeNotOperational.selector, cafeId));
        escrow.createCampaign(cafeId);
    }

    function test_create_revertsWhenPaused() public {
        escrow.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        escrow.createCampaign(cafeId);
    }

    // --- fundCampaign ---

    function test_fund_pullsTokensAndTracksBudget() public {
        uint256 id = escrow.createCampaign(cafeId);
        vm.expectEmit(true, false, false, true);
        emit ICampaignEscrow.CampaignFunded(id, 1_000_000);
        vm.prank(funder);
        escrow.fundCampaign(id, 1_000_000);

        assertEq(pen.balanceOf(address(escrow)), 1_000_000);
        assertEq(escrow.campaigns(id).budget, 1_000_000);
        assertEq(escrow.totalAssignedBudget(), 1_000_000);
    }

    function test_fund_revertsForUnknownCampaign() public {
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(CampaignNotFound.selector, 99));
        escrow.fundCampaign(99, 1);
    }

    function test_fund_revertsOnPublishedAndCancelled() public {
        uint256 id = _publishedCampaign();
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(NotDraft.selector, id));
        escrow.fundCampaign(id, 1);

        uint256 draft = escrow.createCampaign(cafeId);
        escrow.cancelUnpublishedCampaign(draft);
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(NotDraft.selector, draft));
        escrow.fundCampaign(draft, 1);
    }

    function test_fund_revertsOnZeroAmount() public {
        uint256 id = escrow.createCampaign(cafeId);
        vm.prank(funder);
        vm.expectRevert(ZeroAmount.selector);
        escrow.fundCampaign(id, 0);
    }

    // --- assignBudget (crawl funding path) ---

    function test_assign_movesFreeBalanceIntoCampaign() public {
        // NetworkFund's allocateCampaignBudget is a direct transfer: simulate with mint.
        pen.mint(address(escrow), 10_000_000);
        uint256 id = escrow.createCampaign(cafeId);
        escrow.assignBudget(id, 8_000_000);

        assertEq(escrow.campaigns(id).budget, 8_000_000);
        assertEq(escrow.totalAssignedBudget(), 8_000_000);
    }

    function test_assign_revertsBeyondFreeBalance() public {
        pen.mint(address(escrow), 5_000_000);
        uint256 id = escrow.createCampaign(cafeId);
        vm.expectRevert(abi.encodeWithSelector(InsufficientFreeBalance.selector, 5_000_001, 5_000_000));
        escrow.assignBudget(id, 5_000_001);
    }

    function test_assign_doesNotDoubleCountFundedBudget() public {
        // Funded budget is not free balance: funding 3 then assigning 3 must fail
        // with only 3 total in the contract.
        uint256 id = escrow.createCampaign(cafeId);
        vm.prank(funder);
        escrow.fundCampaign(id, 3_000_000);
        vm.expectRevert(abi.encodeWithSelector(InsufficientFreeBalance.selector, 3_000_000, 0));
        escrow.assignBudget(id, 3_000_000);
    }

    function test_assign_revertsForNonOwnerAndNonDraft() public {
        pen.mint(address(escrow), 10_000_000);
        uint256 id = _publishedCampaign();
        vm.expectRevert(abi.encodeWithSelector(NotDraft.selector, id));
        escrow.assignBudget(id, 1);

        uint256 draft = escrow.createCampaign(cafeId);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        escrow.assignBudget(draft, 1);
    }

    // --- publishCampaign ---

    function test_publish_setsParamsAndStatus() public {
        uint256 id = escrow.createCampaign(cafeId);
        vm.prank(funder);
        escrow.fundCampaign(id, PAYOUT * MAX_VOUCHERS);

        uint256 expiry = block.timestamp + 1 days;
        vm.expectEmit(true, false, false, true);
        emit CampaignEscrow.CampaignPublished(id, PAYOUT, MAX_VOUCHERS, expiry);
        escrow.publishCampaign(id, PAYOUT, MAX_VOUCHERS, expiry);

        CampaignEscrow.Campaign memory c = escrow.campaigns(id);
        assertEq(uint8(c.status), uint8(CampaignEscrow.CampaignStatus.Published));
        assertEq(c.voucherPayout, PAYOUT);
        assertEq(c.maxVouchers, MAX_VOUCHERS);
        assertEq(c.expiry, expiry);
    }

    function test_publish_revertsOneWeiShortOfCoverage() public {
        uint256 id = escrow.createCampaign(cafeId);
        vm.prank(funder);
        escrow.fundCampaign(id, PAYOUT * MAX_VOUCHERS - 1);
        vm.expectRevert(
            abi.encodeWithSelector(InsufficientBudget.selector, PAYOUT * MAX_VOUCHERS, PAYOUT * MAX_VOUCHERS - 1)
        );
        escrow.publishCampaign(id, PAYOUT, MAX_VOUCHERS, block.timestamp + 1 days);
    }

    function test_publish_revertsOnPastExpiryZeroParamsAndNonDraft() public {
        uint256 id = escrow.createCampaign(cafeId);
        vm.prank(funder);
        escrow.fundCampaign(id, PAYOUT * MAX_VOUCHERS);

        vm.expectRevert(abi.encodeWithSelector(ExpiryInPast.selector, block.timestamp));
        escrow.publishCampaign(id, PAYOUT, MAX_VOUCHERS, block.timestamp);
        vm.expectRevert(ZeroAmount.selector);
        escrow.publishCampaign(id, 0, MAX_VOUCHERS, block.timestamp + 1 days);
        vm.expectRevert(ZeroAmount.selector);
        escrow.publishCampaign(id, PAYOUT, 0, block.timestamp + 1 days);

        escrow.publishCampaign(id, PAYOUT, MAX_VOUCHERS, block.timestamp + 1 days);
        vm.expectRevert(abi.encodeWithSelector(NotDraft.selector, id));
        escrow.publishCampaign(id, PAYOUT, MAX_VOUCHERS, block.timestamp + 1 days);
    }

    // --- recordProgress ---

    function test_recordProgress_emitsOnly() public {
        uint256 id = _publishedCampaign();
        vm.expectEmit(true, true, false, true);
        emit ICampaignEscrow.ProgressRecorded(id, alice);
        vm.prank(operator);
        escrow.recordProgress(id, alice);
        // Pure bookkeeping: no state change.
        assertEq(escrow.campaigns(id).unlockedCount, 0);
    }

    function test_recordProgress_revertsForNonOperatorDraftAndExpired() public {
        uint256 id = _publishedCampaign();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(NotCampaignOperator.selector, stranger));
        escrow.recordProgress(id, alice);

        uint256 draft = escrow.createCampaign(cafeId);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(NotPublished.selector, draft));
        escrow.recordProgress(draft, alice);

        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(CampaignExpired.selector, id));
        escrow.recordProgress(id, alice);
    }

    // --- unlockVoucher ---

    function test_unlock_advancesStateAndCount() public {
        uint256 id = _publishedCampaign();
        vm.expectEmit(true, true, false, true);
        emit ICampaignEscrow.VoucherUnlocked(id, alice);
        vm.prank(operator);
        escrow.unlockVoucher(id, alice);

        assertEq(uint8(escrow.voucherState(id, alice)), uint8(CampaignEscrow.VoucherState.Unlocked));
        assertEq(escrow.campaigns(id).unlockedCount, 1);
    }

    function test_unlock_revertsOnDoubleUnlock() public {
        uint256 id = _publishedCampaign();
        vm.startPrank(operator);
        escrow.unlockVoucher(id, alice);
        vm.expectRevert(abi.encodeWithSelector(VoucherAlreadyUnlocked.selector, id, alice));
        escrow.unlockVoucher(id, alice);
        vm.stopPrank();
    }

    function test_unlock_revertsAtMaxVouchers() public {
        uint256 id = _publishedCampaign();
        vm.startPrank(operator);
        escrow.unlockVoucher(id, alice);
        escrow.unlockVoucher(id, bob);
        escrow.unlockVoucher(id, makeAddr("carol"));
        vm.expectRevert(abi.encodeWithSelector(MaxVouchersReached.selector, id));
        escrow.unlockVoucher(id, makeAddr("dave"));
        vm.stopPrank();
    }

    function test_unlock_revertsWhenExpiredZeroUserOrNonOperator() public {
        uint256 id = _publishedCampaign();
        vm.prank(operator);
        vm.expectRevert(ZeroAddress.selector);
        escrow.unlockVoucher(id, address(0));

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(NotCampaignOperator.selector, stranger));
        escrow.unlockVoucher(id, alice);

        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(CampaignExpired.selector, id));
        escrow.unlockVoucher(id, alice);
    }

    // --- redeemVoucher ---

    function test_redeem_paysCafeOwnerAndDecrementsBudget() public {
        uint256 id = _publishedCampaign();
        vm.prank(operator);
        escrow.unlockVoucher(id, alice);

        vm.expectEmit(true, true, false, true);
        emit ICampaignEscrow.VoucherRedeemed(id, alice);
        vm.prank(operator);
        escrow.redeemVoucher(id, alice);

        assertEq(pen.balanceOf(cafeOwner), PAYOUT);
        assertEq(uint8(escrow.voucherState(id, alice)), uint8(CampaignEscrow.VoucherState.Redeemed));
        CampaignEscrow.Campaign memory c = escrow.campaigns(id);
        assertEq(c.budget, PAYOUT * (MAX_VOUCHERS - 1));
        assertEq(c.redeemedCount, 1);
        assertEq(escrow.totalAssignedBudget(), PAYOUT * (MAX_VOUCHERS - 1));
    }

    function test_redeem_revertsWithoutUnlockAndOnDoubleRedeem() public {
        uint256 id = _publishedCampaign();
        vm.startPrank(operator);
        vm.expectRevert(abi.encodeWithSelector(VoucherNotUnlocked.selector, id, alice));
        escrow.redeemVoucher(id, alice);

        escrow.unlockVoucher(id, alice);
        escrow.redeemVoucher(id, alice);
        vm.expectRevert(abi.encodeWithSelector(VoucherAlreadyRedeemed.selector, id, alice));
        escrow.redeemVoucher(id, alice);
        // Redeemed user cannot be re-unlocked either.
        vm.expectRevert(abi.encodeWithSelector(VoucherAlreadyRedeemed.selector, id, alice));
        escrow.unlockVoucher(id, alice);
        vm.stopPrank();
    }

    function test_redeem_revertsWhenCafeSuspendedExpiredOrNonOperator() public {
        uint256 id = _publishedCampaign();
        vm.prank(operator);
        escrow.unlockVoucher(id, alice);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(NotCampaignOperator.selector, stranger));
        escrow.redeemVoucher(id, alice);

        vm.prank(registrar);
        registry.setCafeStatus(cafeId, ICafeRegistry.CafeStatus.Suspended);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(CafeNotOperational.selector, cafeId));
        escrow.redeemVoucher(id, alice);

        vm.prank(registrar);
        registry.setCafeStatus(cafeId, ICafeRegistry.CafeStatus.Active);
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(CampaignExpired.selector, id));
        escrow.redeemVoucher(id, alice);
    }

    function test_redeem_paysNewOwnerAfterTwoStepTransfer() public {
        uint256 id = _publishedCampaign();
        vm.prank(operator);
        escrow.unlockVoucher(id, alice);

        address newOwner = makeAddr("newOwner");
        vm.prank(cafeOwner);
        registry.proposeOwner(cafeId, newOwner);
        vm.prank(newOwner);
        registry.acceptOwnership(cafeId);

        vm.prank(operator);
        escrow.redeemVoucher(id, alice);
        assertEq(pen.balanceOf(newOwner), PAYOUT);
        assertEq(pen.balanceOf(cafeOwner), 0);
    }

    // --- cancelUnpublishedCampaign ---

    function test_cancel_refundsFullBudgetToCafeOwner() public {
        uint256 id = escrow.createCampaign(cafeId);
        vm.prank(funder);
        escrow.fundCampaign(id, 7_000_000);

        vm.expectEmit(true, false, false, true);
        emit ICampaignEscrow.CampaignCancelled(id);
        escrow.cancelUnpublishedCampaign(id);

        assertEq(pen.balanceOf(cafeOwner), 7_000_000);
        assertEq(escrow.campaigns(id).budget, 0);
        assertEq(escrow.totalAssignedBudget(), 0);
        assertEq(uint8(escrow.campaigns(id).status), uint8(CampaignEscrow.CampaignStatus.Cancelled));
    }

    function test_cancel_revertsOnPublishedAndNonOwner() public {
        uint256 id = _publishedCampaign();
        vm.expectRevert(abi.encodeWithSelector(NotDraft.selector, id));
        escrow.cancelUnpublishedCampaign(id);

        uint256 draft = escrow.createCampaign(cafeId);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        escrow.cancelUnpublishedCampaign(draft);
    }

    // --- recoverExpiredBudget ---

    function test_recover_returnsResidualIncludingUnredeemedUnlocks() public {
        uint256 id = _publishedCampaign();
        vm.startPrank(operator);
        escrow.unlockVoucher(id, alice);
        escrow.unlockVoucher(id, bob);
        escrow.redeemVoucher(id, alice); // pays PAYOUT to cafeOwner
        vm.stopPrank();

        vm.warp(block.timestamp + 1 days + 1);
        uint256 residual = PAYOUT * (MAX_VOUCHERS - 1); // bob's unlocked voucher dies too
        vm.expectEmit(true, false, false, true);
        emit CampaignEscrow.ExpiredBudgetRecovered(id, residual);
        escrow.recoverExpiredBudget(id);

        assertEq(pen.balanceOf(cafeOwner), PAYOUT + residual);
        assertEq(escrow.campaigns(id).budget, 0);
        assertEq(escrow.totalAssignedBudget(), 0);
    }

    function test_recover_revertsBeforeExpiryOnDraftAndWhenEmpty() public {
        uint256 id = _publishedCampaign();
        vm.expectRevert(abi.encodeWithSelector(CampaignNotExpired.selector, id));
        escrow.recoverExpiredBudget(id);

        uint256 draft = escrow.createCampaign(cafeId);
        vm.expectRevert(abi.encodeWithSelector(NotPublished.selector, draft));
        escrow.recoverExpiredBudget(draft);

        vm.warp(block.timestamp + 1 days + 1);
        escrow.recoverExpiredBudget(id);
        vm.expectRevert(abi.encodeWithSelector(NothingToRecover.selector, id));
        escrow.recoverExpiredBudget(id);
    }

    // --- crawl end-to-end ---

    function test_crawl_endToEnd_freeBalanceToPayout() public {
        // NetworkFund allocates budget by direct transfer (free balance)...
        pen.mint(address(escrow), PAYOUT * 2);
        // ...ops creates the crawl campaign on the fulfilling café and assigns it.
        uint256 id = escrow.createCampaign(otherCafeId);
        escrow.assignBudget(id, PAYOUT * 2);
        escrow.publishCampaign(id, PAYOUT, 2, block.timestamp + 30 days);

        vm.startPrank(operator);
        escrow.recordProgress(id, alice); // café A step, verified off-chain
        escrow.recordProgress(id, alice); // café B step
        escrow.recordProgress(id, alice); // café C step
        escrow.unlockVoucher(id, alice);
        escrow.redeemVoucher(id, alice);
        vm.stopPrank();

        assertEq(pen.balanceOf(otherOwner), PAYOUT);
        assertEq(escrow.campaigns(id).budget, PAYOUT);
    }

    // --- isolation between campaigns ---

    function test_twoCampaigns_budgetsDoNotCross() public {
        uint256 a = _publishedCampaign();
        uint256 b = escrow.createCampaign(otherCafeId);
        vm.prank(funder);
        escrow.fundCampaign(b, PAYOUT);
        escrow.publishCampaign(b, PAYOUT, 1, block.timestamp + 1 days);

        vm.startPrank(operator);
        escrow.unlockVoucher(b, alice);
        escrow.redeemVoucher(b, alice);
        vm.stopPrank();

        assertEq(escrow.campaigns(a).budget, PAYOUT * MAX_VOUCHERS);
        assertEq(escrow.campaigns(b).budget, 0);
        assertEq(pen.balanceOf(otherOwner), PAYOUT);
    }

    // --- ops ---

    function test_setOperator_onlyOwnerAndZeroDisconnects() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        escrow.setCampaignOperator(stranger);

        escrow.setCampaignOperator(address(0));
        uint256 id = _publishedCampaign();
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(NotCampaignOperator.selector, operator));
        escrow.unlockVoucher(id, alice);
    }

    function test_pause_blocksValueOperations() public {
        uint256 id = _publishedCampaign();
        vm.prank(operator);
        escrow.unlockVoucher(id, alice);
        uint256 draft = escrow.createCampaign(cafeId);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        escrow.pause();

        escrow.pause();
        vm.prank(funder);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        escrow.fundCampaign(draft, 1);
        vm.prank(operator);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        escrow.redeemVoucher(id, alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        escrow.cancelUnpublishedCampaign(draft);

        escrow.unpause();
        vm.prank(operator);
        escrow.redeemVoucher(id, alice);
        assertEq(pen.balanceOf(cafeOwner), PAYOUT);
    }
}
