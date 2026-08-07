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
    event ProductEligibilityChanged(
        uint256 indexed cafeId, uint256 indexed productId, ProductKind kind, bool eligible
    );

    function registerCafe(address owner) external returns (uint256 cafeId);
    function setCafeStatus(uint256 cafeId, CafeStatus status) external;
    function authorizeOperator(uint256 cafeId, address operator, bool authorized) external;
    function setEligibleProduct(uint256 cafeId, uint256 productId, ProductKind kind, bool eligible)
        external;
}
