// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NetworkFund, ZeroAddress, ZeroAmount, EpochFinalized, InsufficientFreeBalance} from "../src/NetworkFund.sol";
import {CafeRegistry} from "../src/CafeRegistry.sol";
import {MockPEN} from "../src/MockPEN.sol";
import {ICafeRegistry} from "../src/interfaces/ICafeRegistry.sol";
import {INetworkFund} from "../src/interfaces/INetworkFund.sol";

contract NetworkFundTest is Test {
    MockPEN internal pen;
    CafeRegistry internal registry;
    NetworkFund internal fund;

    address internal admin = makeAddr("admin");
    address internal registrar = makeAddr("registrar");
    address internal recorder = makeAddr("recorder");
    address internal escrow = makeAddr("escrow");
    address internal ops = makeAddr("ops");
    address internal stranger = makeAddr("stranger");

    address internal cafeOwnerA = makeAddr("cafeOwnerA");
    address internal cafeOwnerB = makeAddr("cafeOwnerB");
    uint256 internal cafeA;
    uint256 internal cafeB;

    uint256 internal constant EPOCH = 202608;

    function setUp() public {
        pen = new MockPEN();
        registry = new CafeRegistry(admin);

        // Cache the role before pranking: the view call would consume a vm.prank.
        bytes32 registrarRole = registry.REGISTRAR_ROLE();
        vm.prank(admin);
        registry.grantRole(registrarRole, registrar);

        vm.startPrank(registrar);
        cafeA = registry.registerCafe(cafeOwnerA);
        cafeB = registry.registerCafe(cafeOwnerB);
        registry.setCafeStatus(cafeA, ICafeRegistry.CafeStatus.Active);
        registry.setCafeStatus(cafeB, ICafeRegistry.CafeStatus.Active);
        vm.stopPrank();

        fund = new NetworkFund(IERC20(address(pen)), registry);
        fund.setReferralRecorder(recorder);
        fund.setCampaignEscrow(escrow);
    }

    /// @dev Mimics PlanManager: mPEN lands on the fund by plain transfer, no call.
    function _seed(uint256 amount) internal {
        pen.mint(address(fund), amount);
    }

    function test_constructor_zeroAddressReverts() public {
        vm.expectRevert(ZeroAddress.selector);
        new NetworkFund(IERC20(address(0)), registry);

        vm.expectRevert(ZeroAddress.selector);
        new NetworkFund(IERC20(address(pen)), ICafeRegistry(address(0)));
    }

    function test_freeBalance_countsUnbudgetedTransfers() public {
        assertEq(fund.freeBalance(), 0);
        _seed(100e6);
        assertEq(fund.freeBalance(), 100e6);
        assertEq(fund.totalBudgeted(), 0);
    }

    function test_fundEpoch_splitsIntoBuckets() public {
        _seed(100e6);

        vm.expectEmit(true, false, false, true, address(fund));
        emit INetworkFund.EpochFunded(EPOCH, 100e6);
        fund.fundEpoch(EPOCH, 100e6);

        NetworkFund.Epoch memory e = fund.getEpoch(EPOCH);
        assertEq(e.originPool, 40e6);
        assertEq(e.acquisitionPool, 30e6);
        assertEq(e.crawlPool, 20e6);
        assertEq(e.contingencyPool, 10e6);
        assertEq(fund.totalBudgeted(), 100e6);
        assertEq(fund.freeBalance(), 0);
    }

    function test_fundEpoch_remainderGoesToContingency() public {
        _seed(3);
        fund.fundEpoch(EPOCH, 3);

        NetworkFund.Epoch memory e = fund.getEpoch(EPOCH);
        // 3 * 4000/10000 = 1, 3 * 3000/10000 = 0, 3 * 2000/10000 = 0, remainder 2.
        assertEq(e.originPool, 1);
        assertEq(e.acquisitionPool, 0);
        assertEq(e.crawlPool, 0);
        assertEq(e.contingencyPool, 2);
        assertEq(e.originPool + e.acquisitionPool + e.crawlPool + e.contingencyPool, 3);
    }

    function test_fundEpoch_accumulatesAcrossCalls() public {
        _seed(200e6);
        fund.fundEpoch(EPOCH, 100e6);
        fund.fundEpoch(EPOCH, 100e6);

        NetworkFund.Epoch memory e = fund.getEpoch(EPOCH);
        assertEq(e.originPool, 80e6);
        assertEq(fund.totalBudgeted(), 200e6);
    }

    function test_fundEpoch_revertsBeyondFreeBalance() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6);

        vm.expectRevert(abi.encodeWithSelector(InsufficientFreeBalance.selector, 1, 0));
        fund.fundEpoch(EPOCH, 1);
    }

    function test_fundEpoch_revertsOnZeroAmount() public {
        vm.expectRevert(ZeroAmount.selector);
        fund.fundEpoch(EPOCH, 0);
    }

    function test_fundEpoch_onlyOwner() public {
        _seed(100e6);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        fund.fundEpoch(EPOCH, 100e6);
    }

    function test_fundEpoch_revertsWhenPaused() public {
        _seed(100e6);
        fund.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        fund.fundEpoch(EPOCH, 100e6);

        fund.unpause();
        fund.fundEpoch(EPOCH, 100e6);
        assertEq(fund.totalBudgeted(), 100e6);
    }

    function test_setters_onlyOwnerAndEmit() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        fund.setReferralRecorder(stranger);

        vm.expectEmit(true, false, false, false, address(fund));
        emit NetworkFund.ReferralRecorderSet(ops);
        fund.setReferralRecorder(ops);
        assertEq(fund.referralRecorder(), ops);

        vm.expectEmit(true, false, false, false, address(fund));
        emit NetworkFund.CampaignEscrowSet(ops);
        fund.setCampaignEscrow(ops);
        assertEq(fund.campaignEscrow(), ops);
    }
}
