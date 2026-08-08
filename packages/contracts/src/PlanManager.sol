// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IPlanManager} from "./interfaces/IPlanManager.sol";
import {NotImplemented} from "./NotImplemented.sol";

contract PlanManager is IPlanManager {
    function subscribe(uint256) external pure {
        revert NotImplemented();
    }

    function buyPack(uint256) external pure {
        revert NotImplemented();
    }

    function consumeCredit(uint256) external pure {
        revert NotImplemented();
    }

    function cancel(uint256) external pure {
        revert NotImplemented();
    }

    function withdrawUnusedReserve(uint256) external pure {
        revert NotImplemented();
    }
}
