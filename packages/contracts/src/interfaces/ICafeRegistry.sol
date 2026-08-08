// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface ICafeRegistry {
    enum CafeStatus {
        Pending,
        Active,
        Suspended,
        Exited
    }

    enum ProductKind {
        Emission,
        Reward
    }

    event CafeRegistered(uint256 indexed cafeId, address indexed owner);
    event CafeStatusChanged(uint256 indexed cafeId, CafeStatus status);
    event ProductEligibilityChanged(uint256 indexed cafeId, uint256 indexed productId, ProductKind kind, bool eligible);
    event OperatorAuthorized(uint256 indexed cafeId, address indexed operator, bool authorized);
    event CafeOwnerProposed(uint256 indexed cafeId, address indexed proposed);
    event CafeOwnerTransferred(uint256 indexed cafeId, address indexed prev, address indexed next);

    function registerCafe(address owner) external returns (uint256 cafeId);
    function setCafeStatus(uint256 cafeId, CafeStatus status) external;
    function authorizeOperator(uint256 cafeId, address operator, bool authorized) external;
    function setEligibleProduct(uint256 cafeId, uint256 productId, ProductKind kind, bool eligible) external;
    function proposeOwner(uint256 cafeId, address newOwner) external;
    function acceptOwnership(uint256 cafeId) external;

    function getCafe(uint256 cafeId) external view returns (address owner, CafeStatus status);
    function isAuthorized(uint256 cafeId, address account) external view returns (bool);
    function isEligible(uint256 cafeId, uint256 productId, ProductKind kind) external view returns (bool);
    function isOperational(uint256 cafeId) external view returns (bool);
    function cafeCount() external view returns (uint256);
}
