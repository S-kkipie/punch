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
    event CampaignPublished(uint256 indexed campaignId, uint256 voucherPayout, uint256 maxVouchers, uint256 expiry);
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
    function createCampaign(uint256 sourceCafeId) external onlyOwner whenNotPaused returns (uint256 campaignId) {
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
    function publishCampaign(uint256 campaignId, uint256 voucherPayout, uint256 maxVouchers, uint256 expiry)
        external
        onlyOwner
        whenNotPaused
    {
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
