// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ICafeRegistry} from "./interfaces/ICafeRegistry.sol";

error CafeNotFound(uint256 cafeId);
error InvalidStatusTransition(ICafeRegistry.CafeStatus from, ICafeRegistry.CafeStatus to);
error NotCafeOwner(uint256 cafeId, address caller);
error CafeNotConfigurable(uint256 cafeId, ICafeRegistry.CafeStatus status);
error NotPendingOwner(uint256 cafeId, address caller);
error ZeroAddress();
error NoStateChange();

/// @notice On-chain roster of member cafés: identity, status, operators, product eligibility.
/// @dev Moves no value. Consumers (PlanManager, ConsumptionLog, PunchVault) read from here.
contract CafeRegistry is ICafeRegistry, AccessControl {
    /// @notice Held by the PUNCH ops backend: onboards cafés and changes their status.
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    struct Cafe {
        address owner;
        CafeStatus status;
        address pendingOwner;
    }

    mapping(uint256 cafeId => Cafe) private _cafes;
    mapping(uint256 cafeId => mapping(address account => bool)) private _operators;
    mapping(uint256 cafeId => mapping(uint256 productId => mapping(ProductKind => bool))) private _eligible;

    /// @dev Ids are 1-based, so this doubles as the last assigned id.
    uint256 private _cafeCount;

    /// @param admin Multisig receiving DEFAULT_ADMIN_ROLE. REGISTRAR_ROLE is granted separately,
    /// keeping the ops key distinct from the multisig from the first block.
    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    modifier onlyCafeOwner(uint256 cafeId) {
        address owner = _cafes[cafeId].owner;
        if (owner == address(0)) revert CafeNotFound(cafeId);
        if (owner != msg.sender) revert NotCafeOwner(cafeId, msg.sender);
        _;
    }

    /// @dev A café frozen for risk must not reshuffle its operators or catalogue.
    modifier configurable(uint256 cafeId) {
        CafeStatus status = _cafes[cafeId].status;
        if (status != CafeStatus.Pending && status != CafeStatus.Active) {
            revert CafeNotConfigurable(cafeId, status);
        }
        _;
    }

    /// @inheritdoc ICafeRegistry
    function registerCafe(address owner) external onlyRole(REGISTRAR_ROLE) returns (uint256 cafeId) {
        if (owner == address(0)) revert ZeroAddress();
        cafeId = ++_cafeCount;
        _cafes[cafeId].owner = owner; // status defaults to Pending
        emit CafeRegistered(cafeId, owner);
    }

    /// @inheritdoc ICafeRegistry
    function getCafe(uint256 cafeId) external view returns (address owner, CafeStatus status) {
        Cafe storage cafe = _cafes[cafeId];
        if (cafe.owner == address(0)) revert CafeNotFound(cafeId);
        return (cafe.owner, cafe.status);
    }

    /// @inheritdoc ICafeRegistry
    function cafeCount() external view returns (uint256) {
        return _cafeCount;
    }

    /// @notice Exposes the outstanding transfer proposal so the café panel can show "transfer to X pending" without replaying events.
    /// @dev `pendingOwner` is otherwise observable only through CafeOwnerProposed events.
    function pendingOwnerOf(uint256 cafeId) external view returns (address) {
        Cafe storage cafe = _cafes[cafeId];
        if (cafe.owner == address(0)) revert CafeNotFound(cafeId);
        return cafe.pendingOwner;
    }

    /// @inheritdoc ICafeRegistry
    function setCafeStatus(uint256 cafeId, CafeStatus status) external onlyRole(REGISTRAR_ROLE) {
        Cafe storage cafe = _cafes[cafeId];
        if (cafe.owner == address(0)) revert CafeNotFound(cafeId);

        CafeStatus current = cafe.status;
        if (!_isValidTransition(current, status)) {
            revert InvalidStatusTransition(current, status);
        }

        cafe.status = status;
        if (status == CafeStatus.Exited) {
            cafe.pendingOwner = address(0);
        }
        emit CafeStatusChanged(cafeId, status);
    }

    /// @inheritdoc ICafeRegistry
    function authorizeOperator(uint256 cafeId, address operator, bool authorized)
        external
        onlyCafeOwner(cafeId)
        configurable(cafeId)
    {
        if (operator == address(0)) revert ZeroAddress();
        if (operator == _cafes[cafeId].owner) revert NoStateChange();
        if (_operators[cafeId][operator] == authorized) revert NoStateChange();

        _operators[cafeId][operator] = authorized;
        emit OperatorAuthorized(cafeId, operator, authorized);
    }

    /// @inheritdoc ICafeRegistry
    /// @dev Does not consider café status; combine with `isOperational` before allowing activity.
    function isAuthorized(uint256 cafeId, address account) external view returns (bool) {
        if (account == address(0)) return false;
        return _cafes[cafeId].owner == account || _operators[cafeId][account];
    }

    /// @inheritdoc ICafeRegistry
    /// @dev Records PUNCH's approval decision only. Retail price and COGS stay off-chain;
    /// no contract reads a price to settle (payout and reserve are fixed).
    function setEligibleProduct(uint256 cafeId, uint256 productId, ProductKind kind, bool eligible)
        external
        onlyCafeOwner(cafeId)
        configurable(cafeId)
    {
        if (_eligible[cafeId][productId][kind] == eligible) revert NoStateChange();

        _eligible[cafeId][productId][kind] = eligible;
        emit ProductEligibilityChanged(cafeId, productId, kind, eligible);
    }

    /// @inheritdoc ICafeRegistry
    /// @dev Does not consider café status; combine with `isOperational` before allowing activity.
    function isEligible(uint256 cafeId, uint256 productId, ProductKind kind) external view returns (bool) {
        return _eligible[cafeId][productId][kind];
    }

    /// @inheritdoc ICafeRegistry
    function isOperational(uint256 cafeId) external view returns (bool) {
        return _cafes[cafeId].status == CafeStatus.Active;
    }

    /// @dev Exited is terminal; a café that leaves re-registers under a new id.
    function _isValidTransition(CafeStatus from, CafeStatus to) private pure returns (bool) {
        if (from == to) return false;
        if (from == CafeStatus.Exited) return false;
        if (to == CafeStatus.Exited) return true;
        if (from == CafeStatus.Pending) return to == CafeStatus.Active;
        if (from == CafeStatus.Active) return to == CafeStatus.Suspended;
        return to == CafeStatus.Active; // from == Suspended
    }

    /// @inheritdoc ICafeRegistry
    /// @dev Two-step so a café cannot be sent to an address that cannot claim it.
    /// Allowed while Suspended: selling or repairing a suspended café needs this.
    function proposeOwner(uint256 cafeId, address newOwner) external onlyCafeOwner(cafeId) {
        Cafe storage cafe = _cafes[cafeId];
        if (cafe.status == CafeStatus.Exited) {
            revert CafeNotConfigurable(cafeId, CafeStatus.Exited);
        }
        if (newOwner == address(0)) revert ZeroAddress();
        if (newOwner == cafe.owner) revert NoStateChange();

        cafe.pendingOwner = newOwner;
        emit CafeOwnerProposed(cafeId, newOwner);
    }

    /// @inheritdoc ICafeRegistry
    /// @dev Operators and product eligibility are keyed by cafeId, so they survive the transfer.
    function acceptOwnership(uint256 cafeId) external {
        Cafe storage cafe = _cafes[cafeId];
        if (cafe.owner == address(0)) revert CafeNotFound(cafeId);
        if (cafe.status == CafeStatus.Exited) {
            revert CafeNotConfigurable(cafeId, CafeStatus.Exited);
        }
        if (cafe.pendingOwner != msg.sender) revert NotPendingOwner(cafeId, msg.sender);

        address previous = cafe.owner;
        cafe.owner = msg.sender;
        cafe.pendingOwner = address(0);
        if (_operators[cafeId][previous]) {
            _operators[cafeId][previous] = false;
            emit OperatorAuthorized(cafeId, previous, false);
        }
        emit CafeOwnerTransferred(cafeId, previous, msg.sender);
    }
}
