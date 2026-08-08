// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {INetworkFund} from "./interfaces/INetworkFund.sol";
import {ICafeRegistry} from "./interfaces/ICafeRegistry.sol";

error ZeroAddress();
error ZeroAmount();
error EpochFinalized(uint256 epoch);
error InsufficientFreeBalance(uint256 requested, uint256 available);
error NotReferralRecorder(address caller);
error ReferralProofRequired();
error ReferralIdUsed(bytes32 referralId);
error CafeNotOperational(uint256 cafeId);

/// @notice Custodies the shared network fund: budgets contributions per monthly epoch
/// into four on-chain buckets (40/30/20/10), counts verified referrals, pays prorated
/// origin credit and funds the coffee-crawl pool.
/// @dev This contract never pays PUNCH redemptions. Reward reserve lives in PunchVault
/// and unallocated reserve in PlanManager, so spec invariant 11 (separate ledgers) is
/// structural. PlanManager sends its S/5 share with a plain ERC-20 transfer and no call,
/// so funding is pull-based: `fundEpoch` draws from `freeBalance()`.
contract NetworkFund is INetworkFund, Ownable, Pausable {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant ORIGIN_BPS = 4_000;
    uint256 public constant ACQUISITION_BPS = 3_000;
    uint256 public constant CRAWL_BPS = 2_000;
    uint256 public constant CONTINGENCY_BPS = 1_000;

    /// @notice Buckets an operator may withdraw directly. Origin is claimed by cafés and
    /// crawl is spent through CampaignEscrow, so neither is withdrawable.
    enum Bucket {
        Acquisition,
        Contingency
    }

    struct Epoch {
        uint256 originPool; // frozen at finalize: denominator of the prorate formula
        uint256 originPaid;
        uint256 acquisitionPool;
        uint256 crawlPool;
        uint256 contingencyPool;
        uint256 totalReferrals;
        bool finalized;
        bool originReleased;
    }

    IERC20 public immutable pen;
    ICafeRegistry public immutable registry;

    /// @notice Only address allowed to record referrals; the PUNCH backend in production.
    address public referralRecorder;
    /// @notice Destination of crawl budget allocations; the CampaignEscrow contract.
    address public campaignEscrow;

    mapping(uint256 epoch => Epoch) internal epochs;
    mapping(uint256 epoch => mapping(uint256 cafeId => uint256)) public referrals;
    mapping(uint256 epoch => mapping(uint256 cafeId => bool)) public originClaimed;
    mapping(bytes32 referralId => bool) public usedReferralId;

    /// @notice Sum of every live bucket across all epochs.
    uint256 public totalBudgeted;

    event EpochBucketsFunded(
        uint256 indexed epoch, uint256 origin, uint256 acquisition, uint256 crawl, uint256 contingency
    );
    event ReferralRecorderSet(address indexed recorder);
    event CampaignEscrowSet(address indexed escrow);

    constructor(IERC20 pen_, ICafeRegistry registry_) Ownable(msg.sender) {
        if (address(pen_) == address(0) || address(registry_) == address(0)) revert ZeroAddress();
        pen = pen_;
        registry = registry_;
    }

    /// @notice Rotates the backend key allowed to record referrals. address(0) disconnects it.
    function setReferralRecorder(address recorder) external onlyOwner {
        referralRecorder = recorder;
        emit ReferralRecorderSet(recorder);
    }

    /// @notice Points crawl allocations at the CampaignEscrow. address(0) disables them.
    function setCampaignEscrow(address escrow) external onlyOwner {
        campaignEscrow = escrow;
        emit CampaignEscrowSet(escrow);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @inheritdoc INetworkFund
    /// @dev Pull-based on purpose: contributions arrive as plain transfers, so there is no
    /// `transferFrom` here. The rounding remainder lands in contingency, keeping the four
    /// buckets summing to exactly `amount`.
    function fundEpoch(uint256 epoch, uint256 amount) external onlyOwner whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        Epoch storage e = epochs[epoch];
        if (e.finalized) revert EpochFinalized(epoch);

        uint256 available = freeBalance();
        if (amount > available) revert InsufficientFreeBalance(amount, available);

        uint256 origin = amount * ORIGIN_BPS / BPS_DENOMINATOR;
        uint256 acquisition = amount * ACQUISITION_BPS / BPS_DENOMINATOR;
        uint256 crawl = amount * CRAWL_BPS / BPS_DENOMINATOR;
        uint256 contingency = amount - origin - acquisition - crawl;

        e.originPool += origin;
        e.acquisitionPool += acquisition;
        e.crawlPool += crawl;
        e.contingencyPool += contingency;
        totalBudgeted += amount;

        emit EpochFunded(epoch, amount);
        emit EpochBucketsFunded(epoch, origin, acquisition, crawl, contingency);
    }

    /// @notice Records one verified referral attributed to `originCafeId`.
    /// @dev The referral count is money: it is the denominator of the origin prorate, so a
    /// double count steals credit from every other café. `referralId` (the backend's
    /// receipt/campaign identifier) makes this idempotent. Op lives outside the frozen
    /// interface, which has no room for the id.
    function recordReferralWithProof(uint256 epoch, uint256 originCafeId, bytes32 referralId)
        external
        whenNotPaused
    {
        if (msg.sender != referralRecorder) revert NotReferralRecorder(msg.sender);
        if (referralId == bytes32(0)) revert ReferralProofRequired();
        if (usedReferralId[referralId]) revert ReferralIdUsed(referralId);
        Epoch storage e = epochs[epoch];
        if (e.finalized) revert EpochFinalized(epoch);
        if (!registry.isOperational(originCafeId)) revert CafeNotOperational(originCafeId);

        usedReferralId[referralId] = true;
        referrals[epoch][originCafeId] += 1;
        e.totalReferrals += 1;

        emit ReferralRecorded(epoch, originCafeId, referralId);
    }

    /// @inheritdoc INetworkFund
    /// @dev Always reverts. The frozen signature carries no referral id, so it cannot
    /// deduplicate; keeping it callable would open a second, unguarded door into the
    /// count that decides how the origin pool is split. Use `recordReferralWithProof`.
    function recordReferral(uint256, uint256) external pure {
        revert ReferralProofRequired();
    }

    function finalizeOriginEpoch(uint256) external pure {
        revert();
    }

    function claimOriginCredit(uint256, uint256) external pure {
        revert();
    }

    function allocateCampaignBudget(uint256, uint256) external pure {
        revert();
    }

    /// @notice mPEN held but not yet budgeted to any epoch.
    function freeBalance() public view returns (uint256) {
        return pen.balanceOf(address(this)) - totalBudgeted;
    }

    function getEpoch(uint256 epoch) external view returns (Epoch memory) {
        return epochs[epoch];
    }
}
