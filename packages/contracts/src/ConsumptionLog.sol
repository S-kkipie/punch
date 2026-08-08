// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IConsumptionLog} from "./interfaces/IConsumptionLog.sol";
import {NotImplemented} from "./NotImplemented.sol";

contract ConsumptionLog is IConsumptionLog {
    function recordConsumption(ConsumptionProof calldata, bytes calldata, bytes calldata)
        external
        pure
    {
        revert NotImplemented();
    }
}
