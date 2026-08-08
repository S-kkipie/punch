// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IMockPEN {
    event FaucetDripped(address indexed to, uint256 amount);

    function faucet(uint256 amount) external;
}
