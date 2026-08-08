// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IPlanManager {
    event PlanActivated(uint256 indexed cafeId);
    event PackPurchased(uint256 indexed cafeId);
    event EmissionCreditConsumed(uint256 indexed cafeId);
    event PlanCancelled(uint256 indexed cafeId);
    event UnusedReserveWithdrawn(uint256 indexed cafeId, uint256 amount);

    function subscribe(uint256 cafeId) external;
    function buyPack(uint256 cafeId) external;
    function consumeCredit(uint256 cafeId) external;
    function cancel(uint256 cafeId) external;
    function withdrawUnusedReserve(uint256 cafeId) external;
}
