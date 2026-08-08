// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IConsumptionLog {
    struct ConsumptionProof {
        uint256 cafeId;
        address user;
        uint256 productId;
        uint256 amount;
        bytes32 receiptHash;
        uint256 nonce;
        uint256 expiry;
    }

    event ConsumptionRecorded(
        uint256 indexed cafeId, address indexed user, bytes32 indexed receiptHash
    );

    function recordConsumption(
        ConsumptionProof calldata proof,
        bytes calldata cafeSignature,
        bytes calldata userSignature
    ) external;
}
