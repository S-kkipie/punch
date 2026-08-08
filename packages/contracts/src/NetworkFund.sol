// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {INetworkFund} from "./interfaces/INetworkFund.sol";
import {NotImplemented} from "./NotImplemented.sol";

contract NetworkFund is INetworkFund {
    function fundEpoch(uint256, uint256) external pure {
        revert NotImplemented();
    }

    function recordReferral(uint256, uint256) external pure {
        revert NotImplemented();
    }

    function finalizeOriginEpoch(uint256) external pure {
        revert NotImplemented();
    }

    function claimOriginCredit(uint256, uint256) external pure {
        revert NotImplemented();
    }

    function allocateCampaignBudget(uint256, uint256) external pure {
        revert NotImplemented();
    }
}
