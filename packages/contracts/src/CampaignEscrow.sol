// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ICampaignEscrow} from "./interfaces/ICampaignEscrow.sol";
import {NotImplemented} from "./NotImplemented.sol";

contract CampaignEscrow is ICampaignEscrow {
    function createCampaign(uint256) external pure returns (uint256) {
        revert NotImplemented();
    }

    function fundCampaign(uint256, uint256) external pure {
        revert NotImplemented();
    }

    function recordProgress(uint256, address) external pure {
        revert NotImplemented();
    }

    function unlockVoucher(uint256, address) external pure {
        revert NotImplemented();
    }

    function redeemVoucher(uint256, address) external pure {
        revert NotImplemented();
    }

    function cancelUnpublishedCampaign(uint256) external pure {
        revert NotImplemented();
    }
}
