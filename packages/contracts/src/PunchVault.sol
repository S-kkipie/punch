// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IPunchVault} from "./interfaces/IPunchVault.sol";
import {NotImplemented} from "./NotImplemented.sol";

contract PunchVault is IPunchVault {
    function issue(address, uint256) external pure {
        revert NotImplemented();
    }

    function redeem(address, uint256, uint256) external pure {
        revert NotImplemented();
    }

    function balanceOf(address) external pure returns (uint256) {
        revert NotImplemented();
    }
}
