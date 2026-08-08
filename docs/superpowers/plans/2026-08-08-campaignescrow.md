# CampaignEscrow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `CampaignEscrow` — prefunded marketing-campaign escrow with non-transferable single-claim vouchers, expiry, and fulfillment payout to the source café — replacing the last `NotImplemented` stub.

**Architecture:** One Solidity contract implementing the frozen `ICampaignEscrow` interface plus Ownable + Pausable. Lifecycle `Draft → Published` (Cancelled only from Draft). On-chain enforcement is budget coverage, state, single-claim, and expiry; campaign conditions are verified off-chain by the backend against ConsumptionLog events. A single settable `campaignOperator` rail calls `recordProgress`/`unlockVoucher`/`redeemVoucher`. Payouts and refunds always go to `registry.getCafe(sourceCafeId).owner`.

**Tech Stack:** Solidity ^0.8.30, Foundry (forge test), OpenZeppelin (Ownable, Pausable, SafeERC20), existing `CafeRegistry` + `MockPEN` in tests.

**Spec:** `docs/superpowers/specs/2026-08-08-campaignescrow-design.md`

## Global Constraints

- Frozen interface `packages/contracts/src/interfaces/ICampaignEscrow.sol` must be implemented exactly as-is — never edit it. New ops (`assignBudget`, `publishCampaign`, `recoverExpiredBudget`, `setCampaignOperator`, `pause`, `unpause`) live outside it.
- Custom errors are free-standing at file level (repo convention). Name collisions with other contracts' errors (`ZeroAddress`, `CafeNotOperational`) are fine — file scope, named imports in tests.
- Campaign ids start at 1 (`nextCampaignId = 1`).
- Published campaigns can NEVER be cancelled and have no budget-withdrawal path except `redeemVoucher` and post-expiry `recoverExpiredBudget` (master spec §16: "Campaña publicada no puede retirar presupuesto comprometido contra vouchers válidos").
- Publish requires `budget >= voucherPayout * maxVouchers` (§21 "Escrow insuficiente: no publicar campaña"; §29 "Campaña no promete más que escrow").
- Voucher single-claim: `VoucherState` only advances `None → Unlocked → Redeemed` (§21 "Voucher reclamado: rechazar segundo claim").
- Unlocked vouchers die at expiry — no redemption after `expiry`, and they do not reserve budget against `recoverExpiredBudget` (approved decision 5).
- Never run unscoped `forge fmt` — only `forge fmt --check <own files>` or scoped fmt. Never touch `packages/contracts/script/Deploy.s.sol`.
- All forge commands run from `packages/contracts/`.

---

### Task 1: CampaignEscrow contract + unit tests

**Files:**
- Rewrite: `packages/contracts/src/CampaignEscrow.sol` (currently a `NotImplemented` stub)
- Create: `packages/contracts/test/CampaignEscrow.t.sol`
- Modify: `packages/contracts/test/Scaffold.t.sol` (delete the CampaignEscrow stub test)

**Interfaces:**
- Consumes: `ICampaignEscrow` (frozen), `ICafeRegistry.isOperational/getCafe/registerCafe/setCafeStatus`, `MockPEN.mint`, OZ `Ownable(msg.sender)`, `Pausable`, `SafeERC20`.
- Produces (relied on by Tasks 2 and 3):
  - `constructor(IERC20 pen_, ICafeRegistry registry_)`
  - `enum CampaignStatus { None, Draft, Published, Cancelled }`, `enum VoucherState { None, Unlocked, Redeemed }`
  - `struct Campaign { uint256 sourceCafeId; uint256 budget; uint256 voucherPayout; uint256 maxVouchers; uint256 expiry; uint256 unlockedCount; uint256 redeemedCount; CampaignStatus status; }`
  - `campaigns(uint256) returns (Campaign memory)`, `voucherState(uint256, address) returns (VoucherState)`, `totalAssignedBudget() returns (uint256)`, `nextCampaignId() returns (uint256)`
  - `createCampaign`, `fundCampaign`, `assignBudget`, `publishCampaign`, `recordProgress`, `unlockVoucher`, `redeemVoucher`, `cancelUnpublishedCampaign`, `recoverExpiredBudget`, `setCampaignOperator`, `pause`, `unpause`
  - Free-standing errors listed in Step 2.

- [ ] **Step 1: Write the failing unit tests**

Create `packages/contracts/test/CampaignEscrow.t.sol`:

```solidity
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
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
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
        vm.expectRevert(
            abi.encodeWithSelector(InsufficientFreeBalance.selector, 5_000_001, 5_000_000)
        );
        escrow.assignBudget(id, 5_000_001);
    }

    function test_assign_doesNotDoubleCountFundedBudget() public {
        // Funded budget is not free balance: funding 3 then assigning 3 must fail
        // with only 3 total in the contract.
        uint256 id = escrow.createCampaign(cafeId);
        vm.prank(funder);
        escrow.fundCampaign(id, 3_000_000);
        vm.expectRevert(
            abi.encodeWithSelector(InsufficientFreeBalance.selector, 3_000_000, 0)
        );
        escrow.assignBudget(id, 3_000_000);
    }

    function test_assign_revertsForNonOwnerAndNonDraft() public {
        pen.mint(address(escrow), 10_000_000);
        uint256 id = _publishedCampaign();
        vm.expectRevert(abi.encodeWithSelector(NotDraft.selector, id));
        escrow.assignBudget(id, 1);

        uint256 draft = escrow.createCampaign(cafeId);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
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
            abi.encodeWithSelector(
                InsufficientBudget.selector, PAYOUT * MAX_VOUCHERS, PAYOUT * MAX_VOUCHERS - 1
            )
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

        assertEq(
            uint8(escrow.voucherState(id, alice)), uint8(CampaignEscrow.VoucherState.Unlocked)
        );
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
        assertEq(
            uint8(escrow.voucherState(id, alice)), uint8(CampaignEscrow.VoucherState.Redeemed)
        );
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
        assertEq(
            uint8(escrow.campaigns(id).status), uint8(CampaignEscrow.CampaignStatus.Cancelled)
        );
    }

    function test_cancel_revertsOnPublishedAndNonOwner() public {
        uint256 id = _publishedCampaign();
        vm.expectRevert(abi.encodeWithSelector(NotDraft.selector, id));
        escrow.cancelUnpublishedCampaign(id);

        uint256 draft = escrow.createCampaign(cafeId);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
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
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
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
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `packages/contracts/`:

```bash
forge test --match-contract CampaignEscrowTest
```

Expected: compilation FAILS — `CampaignEscrow.sol` is still the `NotImplemented` stub without constructor args, errors, or the new functions.

- [ ] **Step 3: Implement the contract**

Replace the entire contents of `packages/contracts/src/CampaignEscrow.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ICampaignEscrow} from "./interfaces/ICampaignEscrow.sol";
import {ICafeRegistry} from "./interfaces/ICafeRegistry.sol";

error ZeroAddress();
error ZeroAmount();
error CampaignNotFound(uint256 campaignId);
error NotDraft(uint256 campaignId);
error NotPublished(uint256 campaignId);
error NotCampaignOperator(address caller);
error CafeNotOperational(uint256 cafeId);
error InsufficientBudget(uint256 required, uint256 available);
error InsufficientFreeBalance(uint256 requested, uint256 available);
error ExpiryInPast(uint256 expiry);
error CampaignExpired(uint256 campaignId);
error CampaignNotExpired(uint256 campaignId);
error VoucherAlreadyUnlocked(uint256 campaignId, address user);
error VoucherNotUnlocked(uint256 campaignId, address user);
error VoucherAlreadyRedeemed(uint256 campaignId, address user);
error MaxVouchersReached(uint256 campaignId);
error NothingToRecover(uint256 campaignId);

/// @notice Prefunded marketing-campaign escrow with non-transferable, single-claim
/// vouchers. Campaign conditions (prior purchases, crawl steps, windows) are verified
/// off-chain by the backend against ConsumptionLog events; on-chain enforcement is
/// budget coverage, lifecycle state, single-claim, and expiry. Publish requires
/// budget >= voucherPayout × maxVouchers, and each redemption removes exactly one
/// payout from both budget and promise — a published campaign can never promise more
/// than escrow holds.
/// @dev A published campaign has no budget egress except voucher payouts and, after
/// expiry, `recoverExpiredBudget`. Payouts and refunds always go to the source café's
/// current owner in the registry. Funds sent directly to this contract (NetworkFund's
/// `allocateCampaignBudget`) sit as free balance until `assignBudget` commits them.
contract CampaignEscrow is ICampaignEscrow, Ownable, Pausable {
    using SafeERC20 for IERC20;

    enum CampaignStatus {
        None,
        Draft,
        Published,
        Cancelled
    }

    enum VoucherState {
        None,
        Unlocked,
        Redeemed
    }

    struct Campaign {
        uint256 sourceCafeId;
        uint256 budget;
        uint256 voucherPayout;
        uint256 maxVouchers;
        uint256 expiry;
        uint256 unlockedCount;
        uint256 redeemedCount;
        CampaignStatus status;
    }

    IERC20 public immutable pen;
    ICafeRegistry public immutable registry;

    /// @notice Only address allowed to record progress, unlock, and redeem vouchers;
    /// the campaign backend in production.
    address public campaignOperator;
    uint256 public nextCampaignId = 1;
    /// @notice Sum of all campaign budgets. Contract balance above this is free
    /// balance, assignable to campaigns via `assignBudget`.
    uint256 public totalAssignedBudget;

    mapping(uint256 campaignId => Campaign) private _campaigns;
    mapping(uint256 campaignId => mapping(address user => VoucherState)) public voucherState;

    event CampaignOperatorSet(address indexed operator);
    event BudgetAssigned(uint256 indexed campaignId, uint256 amount);
    event CampaignPublished(
        uint256 indexed campaignId, uint256 voucherPayout, uint256 maxVouchers, uint256 expiry
    );
    event ExpiredBudgetRecovered(uint256 indexed campaignId, uint256 amount);

    constructor(IERC20 pen_, ICafeRegistry registry_) Ownable(msg.sender) {
        if (address(pen_) == address(0) || address(registry_) == address(0)) revert ZeroAddress();
        pen = pen_;
        registry = registry_;
    }

    /// @notice Points the operator rail at the campaign backend. address(0) disconnects it.
    function setCampaignOperator(address operator) external onlyOwner {
        campaignOperator = operator;
        emit CampaignOperatorSet(operator);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @inheritdoc ICampaignEscrow
    function createCampaign(uint256 sourceCafeId)
        external
        onlyOwner
        whenNotPaused
        returns (uint256 campaignId)
    {
        if (!registry.isOperational(sourceCafeId)) revert CafeNotOperational(sourceCafeId);
        campaignId = nextCampaignId++;
        Campaign storage c = _campaigns[campaignId];
        c.sourceCafeId = sourceCafeId;
        c.status = CampaignStatus.Draft;
        emit CampaignCreated(campaignId, sourceCafeId);
    }

    /// @inheritdoc ICampaignEscrow
    /// @dev Permissionless: the interested café (or anyone) funds a draft campaign.
    function fundCampaign(uint256 campaignId, uint256 amount) external whenNotPaused {
        Campaign storage c = _requireDraft(campaignId);
        if (amount == 0) revert ZeroAmount();
        pen.safeTransferFrom(msg.sender, address(this), amount);
        c.budget += amount;
        totalAssignedBudget += amount;
        emit CampaignFunded(campaignId, amount);
    }

    /// @notice Commits free balance (funds NetworkFund transferred directly via
    /// `allocateCampaignBudget`) to a draft campaign. Crawl funding path.
    function assignBudget(uint256 campaignId, uint256 amount) external onlyOwner whenNotPaused {
        Campaign storage c = _requireDraft(campaignId);
        if (amount == 0) revert ZeroAmount();
        uint256 free = pen.balanceOf(address(this)) - totalAssignedBudget;
        if (free < amount) revert InsufficientFreeBalance(amount, free);
        c.budget += amount;
        totalAssignedBudget += amount;
        emit BudgetAssigned(campaignId, amount);
    }

    /// @notice Publishes a draft campaign, fixing its voucher parameters forever.
    /// Requires the budget to cover every promised voucher (master spec §29:
    /// a campaign never promises more than escrow).
    function publishCampaign(
        uint256 campaignId,
        uint256 voucherPayout,
        uint256 maxVouchers,
        uint256 expiry
    ) external onlyOwner whenNotPaused {
        Campaign storage c = _requireDraft(campaignId);
        if (voucherPayout == 0 || maxVouchers == 0) revert ZeroAmount();
        if (expiry <= block.timestamp) revert ExpiryInPast(expiry);
        uint256 required = voucherPayout * maxVouchers;
        if (c.budget < required) revert InsufficientBudget(required, c.budget);
        c.voucherPayout = voucherPayout;
        c.maxVouchers = maxVouchers;
        c.expiry = expiry;
        c.status = CampaignStatus.Published;
        emit CampaignPublished(campaignId, voucherPayout, maxVouchers, expiry);
    }

    /// @inheritdoc ICampaignEscrow
    /// @dev Event-only bookkeeping for indexers; step counting lives in the backend.
    function recordProgress(uint256 campaignId, address user) external whenNotPaused {
        _requireOperator();
        _requireLive(campaignId);
        if (user == address(0)) revert ZeroAddress();
        emit ProgressRecorded(campaignId, user);
    }

    /// @inheritdoc ICampaignEscrow
    function unlockVoucher(uint256 campaignId, address user) external whenNotPaused {
        _requireOperator();
        Campaign storage c = _requireLive(campaignId);
        if (user == address(0)) revert ZeroAddress();
        VoucherState state = voucherState[campaignId][user];
        if (state == VoucherState.Unlocked) revert VoucherAlreadyUnlocked(campaignId, user);
        if (state == VoucherState.Redeemed) revert VoucherAlreadyRedeemed(campaignId, user);
        if (c.unlockedCount >= c.maxVouchers) revert MaxVouchersReached(campaignId);
        voucherState[campaignId][user] = VoucherState.Unlocked;
        c.unlockedCount += 1;
        emit VoucherUnlocked(campaignId, user);
    }

    /// @inheritdoc ICampaignEscrow
    /// @dev CEI: voucher state, counters, and budget move before the payout transfer.
    /// The payout goes to the source café's current owner, so a two-step ownership
    /// transfer in the registry redirects payouts with no escrow state.
    function redeemVoucher(uint256 campaignId, address user) external whenNotPaused {
        _requireOperator();
        Campaign storage c = _requireLive(campaignId);
        VoucherState state = voucherState[campaignId][user];
        if (state == VoucherState.Redeemed) revert VoucherAlreadyRedeemed(campaignId, user);
        if (state != VoucherState.Unlocked) revert VoucherNotUnlocked(campaignId, user);
        if (!registry.isOperational(c.sourceCafeId)) revert CafeNotOperational(c.sourceCafeId);
        (address cafeOwner,) = registry.getCafe(c.sourceCafeId);

        voucherState[campaignId][user] = VoucherState.Redeemed;
        c.redeemedCount += 1;
        c.budget -= c.voucherPayout;
        totalAssignedBudget -= c.voucherPayout;
        pen.safeTransfer(cafeOwner, c.voucherPayout);
        emit VoucherRedeemed(campaignId, user);
    }

    /// @inheritdoc ICampaignEscrow
    /// @dev Draft only — a published campaign can never be cancelled (master spec §16).
    /// Refunds the full budget to the source café's current owner.
    function cancelUnpublishedCampaign(uint256 campaignId) external onlyOwner whenNotPaused {
        Campaign storage c = _requireDraft(campaignId);
        c.status = CampaignStatus.Cancelled;
        uint256 refund = c.budget;
        if (refund > 0) {
            (address cafeOwner,) = registry.getCafe(c.sourceCafeId);
            c.budget = 0;
            totalAssignedBudget -= refund;
            pen.safeTransfer(cafeOwner, refund);
        }
        emit CampaignCancelled(campaignId);
    }

    /// @notice Recovers the residual budget of an expired published campaign to the
    /// source café's current owner. Unlocked-but-unredeemed vouchers die with the
    /// expiry and do not reserve budget (approved design decision 5).
    function recoverExpiredBudget(uint256 campaignId) external onlyOwner whenNotPaused {
        Campaign storage c = _campaigns[campaignId];
        if (c.status != CampaignStatus.Published) revert NotPublished(campaignId);
        if (block.timestamp <= c.expiry) revert CampaignNotExpired(campaignId);
        uint256 amount = c.budget;
        if (amount == 0) revert NothingToRecover(campaignId);
        (address cafeOwner,) = registry.getCafe(c.sourceCafeId);
        c.budget = 0;
        totalAssignedBudget -= amount;
        pen.safeTransfer(cafeOwner, amount);
        emit ExpiredBudgetRecovered(campaignId, amount);
    }

    function campaigns(uint256 campaignId) external view returns (Campaign memory) {
        return _campaigns[campaignId];
    }

    function _requireOperator() private view {
        if (msg.sender != campaignOperator) revert NotCampaignOperator(msg.sender);
    }

    function _requireDraft(uint256 campaignId) private view returns (Campaign storage c) {
        c = _campaigns[campaignId];
        if (c.status == CampaignStatus.None) revert CampaignNotFound(campaignId);
        if (c.status != CampaignStatus.Draft) revert NotDraft(campaignId);
    }

    /// @dev Published and not yet expired.
    function _requireLive(uint256 campaignId) private view returns (Campaign storage c) {
        c = _campaigns[campaignId];
        if (c.status == CampaignStatus.None) revert CampaignNotFound(campaignId);
        if (c.status != CampaignStatus.Published) revert NotPublished(campaignId);
        if (block.timestamp > c.expiry) revert CampaignExpired(campaignId);
    }
}
```

- [ ] **Step 4: Remove the CampaignEscrow stub from Scaffold.t.sol**

`packages/contracts/test/Scaffold.t.sol` currently holds only the CampaignEscrow and MockPEN stubs. Delete the CampaignEscrow import, field, setUp line, and `test_campaignEscrow_reverts_notImplemented`. This is the last contract stub — the remaining file must still compile; it becomes:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {MockPEN} from "../src/MockPEN.sol";

contract ScaffoldTest is Test {
    MockPEN internal mockPEN;

    function setUp() public {
        mockPEN = new MockPEN();
    }
}
```

If `NotImplemented.sol` is no longer imported by any `src/` contract after this task (check with `grep -rn "NotImplemented" src/ test/`), leave `src/NotImplemented.sol` in place — deleting shared scaffold files is out of scope.

- [ ] **Step 5: Run the full contract suite**

```bash
forge test
```

Expected: all tests PASS (202 existing + ~26 new), including `CampaignEscrowTest` and the slimmed `ScaffoldTest`.

- [ ] **Step 6: Format check and commit**

```bash
forge fmt --check src/CampaignEscrow.sol test/CampaignEscrow.t.sol test/Scaffold.t.sol
```

If it reports issues: `forge fmt src/CampaignEscrow.sol test/CampaignEscrow.t.sol test/Scaffold.t.sol` (scoped only — NEVER unscoped).

```bash
git add src/CampaignEscrow.sol test/CampaignEscrow.t.sol test/Scaffold.t.sol
git commit -m "feat(contracts): implement CampaignEscrow with vouchers and expiry"
```

---

### Task 2: Invariant tests

**Files:**
- Create: `packages/contracts/test/CampaignEscrowInvariant.t.sol`

**Interfaces:**
- Consumes (from Task 1): every public function of `CampaignEscrow` listed in Task 1's Produces block, plus `CampaignEscrow.Campaign`/`CampaignStatus`/`VoucherState` types. `MockPEN.mint(address,uint256)`, `CafeRegistry` as in Task 1.
- Produces: nothing downstream — terminal quality gate for the money path.

- [ ] **Step 1: Write the handler and invariants**

Create `packages/contracts/test/CampaignEscrowInvariant.t.sol`:

```solidity
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
        assertEq(mintedToEscrowSystem, pen.balanceOf(address(escrow)) + ghostPaidOut);
    }
}
```

Note for the conservation invariant: the handler funds campaigns from its own minted balance and never receives payouts (those go to café owners), so `totalSupply − handlerBalance` is exactly what entered the escrow system, and it must equal escrow balance plus tracked outflows. If `MockPEN.totalSupply()` behaves differently than expected (e.g., a pre-mint in its constructor), adjust by recording a ghost `totalMintedIn` in the handler instead — increment it in `createAndFund` and `donateAndAssign` by the minted amount — and assert `ghostMintedIn == pen.balanceOf(address(escrow)) + ghostPaidOut`.

- [ ] **Step 2: Run the invariant suite**

```bash
forge test --match-contract CampaignEscrowInvariantTest
```

Expected: 4 invariants PASS across fuzz runs. If `invariant_conservation` fails on setup assumptions (MockPEN pre-mint), apply the ghost-counter fallback described above and re-run.

- [ ] **Step 3: Run the full suite**

```bash
forge test
```

Expected: everything green.

- [ ] **Step 4: Format check and commit**

```bash
forge fmt --check test/CampaignEscrowInvariant.t.sol
git add test/CampaignEscrowInvariant.t.sol
git commit -m "test(contracts): add CampaignEscrow invariant suite"
```

---

### Task 3: Deploy script

**Files:**
- Create: `packages/contracts/script/DeployCampaignEscrow.s.sol`

**Interfaces:**
- Consumes (from Task 1): `CampaignEscrow` constructor `(IERC20 pen_, ICafeRegistry registry_)`.
- Produces: `DeployCampaignEscrow.run() returns (CampaignEscrow)` reading env vars `PEN_ADDRESS`, `CAFE_REGISTRY_ADDRESS`. Post-deploy wiring (`setCampaignOperator`, `networkFund.setCampaignEscrow`) is deliberately NOT done here — owner txs, same convention as every other deploy script. Shared `script/Deploy.s.sol` is not touched.

- [ ] **Step 1: Write the deploy script**

Create `packages/contracts/script/DeployCampaignEscrow.s.sol` (pattern copied from `DeployPunchVault.s.sol`):

```solidity
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
```

- [ ] **Step 2: Verify it compiles and dry-runs**

```bash
forge build
PEN_ADDRESS=0x000000000000000000000000000000000000dEaD \
CAFE_REGISTRY_ADDRESS=0x000000000000000000000000000000000000bEEF \
forge script script/DeployCampaignEscrow.s.sol
```

Expected: build succeeds; the script simulation runs and returns the deployed instance (local simulation only, no broadcast flag).

- [ ] **Step 3: Run the full suite one last time**

```bash
forge test
```

Expected: everything green.

- [ ] **Step 4: Format check and commit**

```bash
forge fmt --check script/DeployCampaignEscrow.s.sol
git add script/DeployCampaignEscrow.s.sol
git commit -m "feat(contracts): add CampaignEscrow deploy script"
```
