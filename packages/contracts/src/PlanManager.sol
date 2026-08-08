// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPlanManager} from "./interfaces/IPlanManager.sol";
import {ICafeRegistry} from "./interfaces/ICafeRegistry.sol";

error ZeroAddress();
error NotAuthorizedForCafe(uint256 cafeId, address account);
error CafeNotOperational(uint256 cafeId);
error PlanNotActive(uint256 cafeId);
error PlanStillActive(uint256 cafeId);
error NoCredits(uint256 cafeId);
error NotConsumptionLog(address caller);
error NotCafeOwner(uint256 cafeId, address account);
error NothingToWithdraw(uint256 cafeId);

/// @notice Runs each café's plan: charges in mPEN, splits revenue, tracks emission
/// credits, and custodies the unallocated reserve backing them (S/0.30 per credit).
/// @dev Emission is orchestrated by ConsumptionLog: it calls `consumeCredit` here and
/// then `PunchVault.issue`. This contract never issues PUNCH itself. The reserve share
/// of each purchase stays here as unallocated reserve and moves to the vault credit by
/// credit on emission, so `withdrawUnusedReserve` can never touch reserve backing live
/// PUNCH (spec invariant 9).
contract PlanManager is IPlanManager, Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant PLAN_PRICE = 49e6;
    uint256 public constant PACK_PRICE = 40e6;
    uint256 public constant CREDITS_PER_PURCHASE = 100;
    uint256 public constant RESERVE_PER_CREDIT = 300_000; // S/0.30
    uint256 public constant PLAN_FUND_SHARE = 5e6;
    uint256 public constant PLAN_TREASURY_SHARE = 14e6;
    uint256 public constant PACK_FUND_SHARE = 5e6;
    uint256 public constant PACK_TREASURY_SHARE = 5e6;

    IERC20 public immutable pen;
    ICafeRegistry public immutable registry;
    address public immutable vault;
    address public immutable networkFund;
    address public immutable treasury;

    /// @notice Only address allowed to call `consumeCredit`; the ConsumptionLog contract in production.
    address public consumptionLog;

    mapping(uint256 cafeId => uint256) public credits;
    mapping(uint256 cafeId => uint256) public unallocatedReserve;
    mapping(uint256 cafeId => bool) public planActive;

    event ConsumptionLogSet(address indexed consumptionLog);

    constructor(IERC20 pen_, ICafeRegistry registry_, address vault_, address networkFund_, address treasury_)
        Ownable(msg.sender)
    {
        if (
            address(pen_) == address(0) || address(registry_) == address(0) || vault_ == address(0)
                || networkFund_ == address(0) || treasury_ == address(0)
        ) revert ZeroAddress();
        pen = pen_;
        registry = registry_;
        vault = vault_;
        networkFund = networkFund_;
        treasury = treasury_;
    }

    /// @notice Points `consumeCredit` at the ConsumptionLog. address(0) disconnects emission entirely.
    function setConsumptionLog(address log) external onlyOwner {
        consumptionLog = log;
        emit ConsumptionLogSet(log);
    }

    /// @inheritdoc IPlanManager
    function subscribe(uint256 cafeId) external {
        _requireOperationalCaller(cafeId);
        _purchase(cafeId, PLAN_PRICE, PLAN_FUND_SHARE, PLAN_TREASURY_SHARE);
        planActive[cafeId] = true;
        emit PlanActivated(cafeId);
    }

    /// @inheritdoc IPlanManager
    function buyPack(uint256 cafeId) external {
        _requireOperationalCaller(cafeId);
        if (!planActive[cafeId]) revert PlanNotActive(cafeId);
        _purchase(cafeId, PACK_PRICE, PACK_FUND_SHARE, PACK_TREASURY_SHARE);
        emit PackPurchased(cafeId);
    }

    /// @inheritdoc IPlanManager
    function consumeCredit(uint256 cafeId) external {
        if (msg.sender != consumptionLog) revert NotConsumptionLog(msg.sender);
        if (!planActive[cafeId]) revert PlanNotActive(cafeId);
        if (!registry.isOperational(cafeId)) revert CafeNotOperational(cafeId);
        if (credits[cafeId] == 0) revert NoCredits(cafeId);

        credits[cafeId] -= 1;
        unallocatedReserve[cafeId] -= RESERVE_PER_CREDIT;
        pen.safeTransfer(vault, RESERVE_PER_CREDIT);
        emit EmissionCreditConsumed(cafeId);
    }

    /// @inheritdoc IPlanManager
    function cancel(uint256 cafeId) external {
        _requireCafeOwner(cafeId);
        if (!planActive[cafeId]) revert PlanNotActive(cafeId);
        planActive[cafeId] = false;
        emit PlanCancelled(cafeId);
    }

    /// @inheritdoc IPlanManager
    /// @dev No operational requirement: the owner of a suspended or exited café must
    /// still be able to recover the reserve of never-issued credits (spec §09).
    function withdrawUnusedReserve(uint256 cafeId) external {
        address cafeOwner = _requireCafeOwner(cafeId);
        if (planActive[cafeId]) revert PlanStillActive(cafeId);
        uint256 amount = unallocatedReserve[cafeId];
        if (amount == 0) revert NothingToWithdraw(cafeId);

        credits[cafeId] = 0;
        unallocatedReserve[cafeId] = 0;
        pen.safeTransfer(cafeOwner, amount);
        emit UnusedReserveWithdrawn(cafeId, amount);
    }

    /// @dev Split and credit accrual happen in one transaction (spec §17). The reserve
    /// share (price − fund − treasury) stays in this contract as unallocated reserve.
    function _purchase(uint256 cafeId, uint256 price, uint256 fundShare, uint256 treasuryShare) private {
        uint256 reserveShare = price - fundShare - treasuryShare;
        pen.safeTransferFrom(msg.sender, address(this), price);
        pen.safeTransfer(networkFund, fundShare);
        pen.safeTransfer(treasury, treasuryShare);
        credits[cafeId] += CREDITS_PER_PURCHASE;
        unallocatedReserve[cafeId] += reserveShare;
    }

    function _requireOperationalCaller(uint256 cafeId) private view {
        if (!registry.isAuthorized(cafeId, msg.sender)) revert NotAuthorizedForCafe(cafeId, msg.sender);
        if (!registry.isOperational(cafeId)) revert CafeNotOperational(cafeId);
    }

    function _requireCafeOwner(uint256 cafeId) private view returns (address cafeOwner) {
        (cafeOwner,) = registry.getCafe(cafeId);
        if (cafeOwner != msg.sender) revert NotCafeOwner(cafeId, msg.sender);
    }
}
