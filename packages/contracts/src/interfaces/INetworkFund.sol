// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface INetworkFund {
    event EpochFunded(uint256 indexed epoch, uint256 amount);
    event ReferralRecorded(uint256 indexed epoch, uint256 indexed originCafeId);
    event OriginEpochFinalized(uint256 indexed epoch);
    event OriginCreditClaimed(uint256 indexed epoch, uint256 indexed cafeId, uint256 amount);
    event CampaignBudgetAllocated(uint256 indexed epoch, uint256 amount);

    function fundEpoch(uint256 epoch, uint256 amount) external;
    function recordReferral(uint256 epoch, uint256 originCafeId) external;
    function finalizeOriginEpoch(uint256 epoch) external;
    function claimOriginCredit(uint256 epoch, uint256 cafeId) external;
    function allocateCampaignBudget(uint256 epoch, uint256 amount) external;
}
