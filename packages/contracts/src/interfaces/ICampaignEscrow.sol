// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface ICampaignEscrow {
    event CampaignCreated(uint256 indexed campaignId, uint256 indexed sourceCafeId);
    event CampaignFunded(uint256 indexed campaignId, uint256 amount);
    event ProgressRecorded(uint256 indexed campaignId, address indexed user);
    event VoucherUnlocked(uint256 indexed campaignId, address indexed user);
    event VoucherRedeemed(uint256 indexed campaignId, address indexed user);
    event CampaignCancelled(uint256 indexed campaignId);

    function createCampaign(uint256 sourceCafeId) external returns (uint256 campaignId);
    function fundCampaign(uint256 campaignId, uint256 amount) external;
    function recordProgress(uint256 campaignId, address user) external;
    function unlockVoucher(uint256 campaignId, address user) external;
    function redeemVoucher(uint256 campaignId, address user) external;
    function cancelUnpublishedCampaign(uint256 campaignId) external;
}
