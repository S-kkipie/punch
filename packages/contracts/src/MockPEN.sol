// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IMockPEN} from "./interfaces/IMockPEN.sol";
import {NotImplemented} from "./NotImplemented.sol";

contract MockPEN is IMockPEN {
    function faucet(uint256) external pure {
        revert NotImplemented();
    }
}
