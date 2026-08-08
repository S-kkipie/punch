// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPunchVault} from "./interfaces/IPunchVault.sol";
import {ICafeRegistry} from "./interfaces/ICafeRegistry.sol";

error ZeroAddress();
error NotConsumptionLog(address caller);
error NotRedeemer(address caller);
error InsufficientReserve(uint256 required, uint256 available);
error InsufficientPunch(address user, uint256 balance);
error HostNotOperational(uint256 cafeId);
error ProductNotEligibleReward(uint256 cafeId, uint256 productId);

/// @notice Non-transferable PUNCH ledger and reward-reserve custodian. Issues one PUNCH
/// per validated consumption, and on redemption atomically burns twelve and pays the
/// fixed S/3.60 host payout from the reserve (12 × S/0.30 = S/3.60, so redemption
/// preserves coverage by construction; only emission needs the explicit check).
/// @dev Two independently settable rails: `consumptionLog` may issue, `redeemer` may
/// redeem. The vault records no per-café provenance for live PUNCH — a user's balance
/// stays valid if the emitting café leaves the network. No transfer or withdrawal path
/// exists; the redemption payout is the only mPEN egress.
contract PunchVault is IPunchVault, Ownable, Pausable {
    using SafeERC20 for IERC20;

    uint256 public constant PUNCHES_PER_REWARD = 12;
    uint256 public constant RESERVE_PER_PUNCH = 300_000; // S/0.30
    uint256 public constant HOST_PAYOUT = 3_600_000; // S/3.60

    IERC20 public immutable pen;
    ICafeRegistry public immutable registry;

    /// @notice Only address allowed to call `issue`; the ConsumptionLog contract in production.
    address public consumptionLog;
    /// @notice Only address allowed to call `redeem`; the redemption backend in production.
    address public redeemer;

    mapping(address user => uint256) private _balances;
    uint256 public totalLivePunch;

    event ConsumptionLogSet(address indexed consumptionLog);
    event RedeemerSet(address indexed redeemer);

    constructor(IERC20 pen_, ICafeRegistry registry_) Ownable(msg.sender) {
        if (address(pen_) == address(0) || address(registry_) == address(0)) revert ZeroAddress();
        pen = pen_;
        registry = registry_;
    }

    /// @notice Points `issue` at the ConsumptionLog. address(0) disconnects the emission rail.
    function setConsumptionLog(address log) external onlyOwner {
        consumptionLog = log;
        emit ConsumptionLogSet(log);
    }

    /// @notice Points `redeem` at the redemption backend. address(0) disconnects the redemption rail.
    function setRedeemer(address redeemer_) external onlyOwner {
        redeemer = redeemer_;
        emit RedeemerSet(redeemer_);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @inheritdoc IPunchVault
    /// @dev Coverage is checked against the real mPEN balance: PlanManager has already
    /// forwarded S/0.30 for this credit earlier in the same orchestrated transaction,
    /// so a compliant flow always passes. Donations only raise coverage. No registry
    /// checks here — ConsumptionLog validates the proof and PlanManager validates plan,
    /// café status, and credit before this call. `cafeId` flows only to the event.
    function issue(address user, uint256 cafeId) external whenNotPaused {
        if (msg.sender != consumptionLog) revert NotConsumptionLog(msg.sender);
        if (user == address(0)) revert ZeroAddress();

        uint256 required = (totalLivePunch + 1) * RESERVE_PER_PUNCH;
        uint256 available = pen.balanceOf(address(this));
        if (available < required) revert InsufficientReserve(required, available);

        _balances[user] += 1;
        totalLivePunch += 1;
        emit PunchIssued(user, cafeId);
    }

    /// @inheritdoc IPunchVault
    /// @dev Burn and payout are one transaction (master-spec invariant 8). The payout
    /// goes to the host café's current owner in the registry, so a two-step ownership
    /// transfer redirects payouts with no vault state.
    function redeem(address user, uint256 hostCafeId, uint256 productId) external whenNotPaused {
        if (msg.sender != redeemer) revert NotRedeemer(msg.sender);

        uint256 balance = _balances[user];
        if (balance < PUNCHES_PER_REWARD) revert InsufficientPunch(user, balance);
        if (!registry.isOperational(hostCafeId)) revert HostNotOperational(hostCafeId);
        if (!registry.isEligible(hostCafeId, productId, ICafeRegistry.ProductKind.Reward)) {
            revert ProductNotEligibleReward(hostCafeId, productId);
        }
        (address hostOwner,) = registry.getCafe(hostCafeId);

        _balances[user] = balance - PUNCHES_PER_REWARD;
        totalLivePunch -= PUNCHES_PER_REWARD;
        pen.safeTransfer(hostOwner, HOST_PAYOUT);
        emit PunchBurned(user, PUNCHES_PER_REWARD);
        emit RewardRedeemed(user, hostCafeId, productId);
        emit HostPaid(hostCafeId, HOST_PAYOUT);
    }

    /// @inheritdoc IPunchVault
    function balanceOf(address user) external view returns (uint256) {
        return _balances[user];
    }
}
