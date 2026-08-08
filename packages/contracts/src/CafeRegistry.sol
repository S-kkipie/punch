// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ICafeRegistry} from "./interfaces/ICafeRegistry.sol";
import {NotImplemented} from "./NotImplemented.sol";

contract CafeRegistry is ICafeRegistry {
    function registerCafe(address) external pure returns (uint256) {
        revert NotImplemented();
    }

    function setCafeStatus(uint256, CafeStatus) external pure {
        revert NotImplemented();
    }

    function authorizeOperator(uint256, address, bool) external pure {
        revert NotImplemented();
    }

    function setEligibleProduct(uint256, uint256, ProductKind, bool) external pure {
        revert NotImplemented();
    }
}
