// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IMockPEN} from "./interfaces/IMockPEN.sol";

error FaucetCapExceeded(uint256 requested, uint256 max);

/// @notice Testnet mock of a PEN stablecoin. Not a productive fiat solution.
contract MockPEN is IMockPEN, ERC20, Ownable {
    /// @notice Maximum amount a single faucet call can mint (1000 PEN, 6 decimals).
    uint256 public constant FAUCET_MAX = 1_000 * 1e6;

    constructor() ERC20("Mock PEN", "mPEN") Ownable(msg.sender) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @inheritdoc IMockPEN
    function faucet(uint256 amount) external {
        if (amount > FAUCET_MAX) {
            revert FaucetCapExceeded(amount, FAUCET_MAX);
        }
        _mint(msg.sender, amount);
        emit FaucetDripped(msg.sender, amount);
    }

    /// @notice Uncapped mint for ops/seed tooling. Intentionally outside IMockPEN.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
