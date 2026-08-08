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
        address pendingOwner;
        CafeStatus status;
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

    // --- Implemented in Tasks 2-5. Temporary so the contract satisfies ICafeRegistry. ---

    function setCafeStatus(uint256, CafeStatus) external {
        revert("todo: task 2");
    }

    function authorizeOperator(uint256, address, bool) external {
        revert("todo: task 3");
    }

    function isAuthorized(uint256, address) external view returns (bool) {
        return false;
    }

    function setEligibleProduct(uint256, uint256, ProductKind, bool) external {
        revert("todo: task 4");
    }

    function isEligible(uint256, uint256, ProductKind) external view returns (bool) {
        return false;
    }

    function isOperational(uint256) external view returns (bool) {
        return false;
    }

    function proposeOwner(uint256, address) external {
        revert("todo: task 5");
    }

    function acceptOwnership(uint256) external {
        revert("todo: task 5");
    }
}
