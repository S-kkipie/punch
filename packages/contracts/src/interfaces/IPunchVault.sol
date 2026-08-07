// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IPunchVault {
    event PunchIssued(address indexed user, uint256 indexed cafeId);
    event PunchBurned(address indexed user, uint256 amount);
    event RewardRedeemed(address indexed user, uint256 indexed hostCafeId, uint256 indexed productId);
    event HostPaid(uint256 indexed hostCafeId, uint256 amount);

    function issue(address user, uint256 cafeId) external;
    function redeem(address user, uint256 hostCafeId, uint256 productId) external;
    function balanceOf(address user) external view returns (uint256);
}
