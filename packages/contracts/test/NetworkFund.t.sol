// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    NetworkFund,
    ZeroAddress,
    ZeroAmount,
    EpochFinalized,
    InsufficientFreeBalance,
    NotReferralRecorder,
    ReferralProofRequired,
    ReferralIdUsed,
    CafeNotOperational,
    EpochNotFinalized,
    OriginAlreadyClaimed,
    NoReferrals,
    NothingToRelease,
    OriginPoolReleased
} from "../src/NetworkFund.sol";
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

    function _record(uint256 cafeId, bytes32 referralId) internal {
        vm.prank(recorder);
        fund.recordReferralWithProof(EPOCH, cafeId, referralId);
    }

    function test_recordReferral_withoutProofAlwaysReverts() public {
        vm.prank(recorder);
        vm.expectRevert(ReferralProofRequired.selector);
        fund.recordReferral(EPOCH, cafeA);

        // Not even the owner has a proof-less path.
        vm.expectRevert(ReferralProofRequired.selector);
        fund.recordReferral(EPOCH, cafeA);
    }

    function test_recordReferralWithProof_countsPerCafe() public {
        vm.expectEmit(true, true, true, false, address(fund));
        emit INetworkFund.ReferralRecorded(EPOCH, cafeA, keccak256("r1"));
        _record(cafeA, keccak256("r1"));
        _record(cafeA, keccak256("r2"));
        _record(cafeB, keccak256("r3"));

        assertEq(fund.referrals(EPOCH, cafeA), 2);
        assertEq(fund.referrals(EPOCH, cafeB), 1);
        assertEq(fund.getEpoch(EPOCH).totalReferrals, 3);
    }

    function test_recordReferralWithProof_rejectsDuplicateId() public {
        _record(cafeA, keccak256("r1"));

        vm.prank(recorder);
        vm.expectRevert(abi.encodeWithSelector(ReferralIdUsed.selector, keccak256("r1")));
        fund.recordReferralWithProof(EPOCH, cafeB, keccak256("r1"));

        assertEq(fund.getEpoch(EPOCH).totalReferrals, 1);
    }

    function test_recordReferralWithProof_rejectsDuplicateIdAcrossEpochs() public {
        _record(cafeA, keccak256("r1"));

        vm.prank(recorder);
        vm.expectRevert(abi.encodeWithSelector(ReferralIdUsed.selector, keccak256("r1")));
        fund.recordReferralWithProof(EPOCH + 1, cafeA, keccak256("r1"));
    }

    function test_recordReferralWithProof_rejectsZeroId() public {
        vm.prank(recorder);
        vm.expectRevert(ReferralProofRequired.selector);
        fund.recordReferralWithProof(EPOCH, cafeA, bytes32(0));
    }

    function test_recordReferralWithProof_onlyRecorder() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(NotReferralRecorder.selector, stranger));
        fund.recordReferralWithProof(EPOCH, cafeA, keccak256("r1"));
    }

    function test_recordReferralWithProof_rejectsNonOperationalCafe() public {
        vm.prank(registrar);
        registry.setCafeStatus(cafeA, ICafeRegistry.CafeStatus.Suspended);

        vm.prank(recorder);
        vm.expectRevert(abi.encodeWithSelector(CafeNotOperational.selector, cafeA));
        fund.recordReferralWithProof(EPOCH, cafeA, keccak256("r1"));
    }

    function test_recordReferralWithProof_revertsWhenPaused() public {
        fund.pause();
        vm.prank(recorder);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        fund.recordReferralWithProof(EPOCH, cafeA, keccak256("r1"));
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

    function test_finalize_freezesSnapshotAndBlocksMoreInput() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6);
        _record(cafeA, keccak256("r1"));

        vm.expectEmit(true, false, false, true, address(fund));
        emit INetworkFund.OriginEpochFinalized(EPOCH, 1, 40e6);
        fund.finalizeOriginEpoch(EPOCH);

        assertTrue(fund.getEpoch(EPOCH).finalized);

        _seed(10e6);
        vm.expectRevert(abi.encodeWithSelector(EpochFinalized.selector, EPOCH));
        fund.fundEpoch(EPOCH, 10e6);

        vm.prank(recorder);
        vm.expectRevert(abi.encodeWithSelector(EpochFinalized.selector, EPOCH));
        fund.recordReferralWithProof(EPOCH, cafeA, keccak256("r2"));
    }

    function test_finalize_onlyOwnerAndOnlyOnce() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        fund.finalizeOriginEpoch(EPOCH);

        fund.finalizeOriginEpoch(EPOCH);
        vm.expectRevert(abi.encodeWithSelector(EpochFinalized.selector, EPOCH));
        fund.finalizeOriginEpoch(EPOCH);
    }

    function test_claim_paysProrataToCafeOwner() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6); // originPool = 40e6
        _record(cafeA, keccak256("r1"));
        _record(cafeA, keccak256("r2"));
        _record(cafeA, keccak256("r3"));
        _record(cafeB, keccak256("r4"));
        fund.finalizeOriginEpoch(EPOCH);

        assertEq(fund.pendingOriginCredit(EPOCH, cafeA), 30e6);
        assertEq(fund.pendingOriginCredit(EPOCH, cafeB), 10e6);

        vm.prank(stranger);
        fund.claimOriginCredit(EPOCH, cafeA);

        assertEq(pen.balanceOf(cafeOwnerA), 30e6);
        assertEq(pen.balanceOf(stranger), 0);
        assertEq(fund.pendingOriginCredit(EPOCH, cafeA), 0);
        assertEq(fund.getEpoch(EPOCH).originPaid, 30e6);
        assertEq(fund.totalBudgeted(), 70e6);
    }

    function test_claim_roundingDustStaysInPool() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6); // originPool = 40e6
        _record(cafeA, keccak256("r1"));
        _record(cafeA, keccak256("r2"));
        _record(cafeB, keccak256("r3"));
        fund.finalizeOriginEpoch(EPOCH);

        vm.prank(cafeOwnerA);
        fund.claimOriginCredit(EPOCH, cafeA);
        vm.prank(cafeOwnerB);
        fund.claimOriginCredit(EPOCH, cafeB);

        assertEq(pen.balanceOf(cafeOwnerA), 26_666_666);
        assertEq(pen.balanceOf(cafeOwnerB), 13_333_333);
        NetworkFund.Epoch memory e = fund.getEpoch(EPOCH);
        assertEq(e.originPool - e.originPaid, 1);
    }

    function test_claim_revertsOnSecondClaim() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6);
        _record(cafeA, keccak256("r1"));
        fund.finalizeOriginEpoch(EPOCH);

        fund.claimOriginCredit(EPOCH, cafeA);
        vm.expectRevert(abi.encodeWithSelector(OriginAlreadyClaimed.selector, EPOCH, cafeA));
        fund.claimOriginCredit(EPOCH, cafeA);
    }

    function test_claim_revertsBeforeFinalize() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6);
        _record(cafeA, keccak256("r1"));

        vm.expectRevert(abi.encodeWithSelector(EpochNotFinalized.selector, EPOCH));
        fund.claimOriginCredit(EPOCH, cafeA);
    }

    function test_claim_revertsWithoutReferrals() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6);
        _record(cafeA, keccak256("r1"));
        fund.finalizeOriginEpoch(EPOCH);

        vm.expectRevert(abi.encodeWithSelector(NoReferrals.selector, EPOCH, cafeB));
        fund.claimOriginCredit(EPOCH, cafeB);
    }

    function test_claim_revertsForSuspendedCafe() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6);
        _record(cafeA, keccak256("r1"));
        fund.finalizeOriginEpoch(EPOCH);

        vm.prank(registrar);
        registry.setCafeStatus(cafeA, ICafeRegistry.CafeStatus.Suspended);

        vm.expectRevert(abi.encodeWithSelector(CafeNotOperational.selector, cafeA));
        fund.claimOriginCredit(EPOCH, cafeA);
        assertEq(fund.pendingOriginCredit(EPOCH, cafeA), 40e6);
    }

    function test_claim_revertsWhenPaused() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6);
        _record(cafeA, keccak256("r1"));
        fund.finalizeOriginEpoch(EPOCH);
        fund.pause();

        vm.expectRevert(Pausable.EnforcedPause.selector);
        fund.claimOriginCredit(EPOCH, cafeA);
    }

    function test_release_returnsRemainderToFreeBalance() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6); // originPool = 40e6
        _record(cafeA, keccak256("r1"));
        _record(cafeB, keccak256("r2"));
        fund.finalizeOriginEpoch(EPOCH);

        fund.claimOriginCredit(EPOCH, cafeA); // 20e6 out
        assertEq(fund.freeBalance(), 0);

        vm.expectEmit(true, false, false, true, address(fund));
        emit NetworkFund.UnclaimedOriginReleased(EPOCH, 20e6);
        fund.releaseUnclaimedOrigin(EPOCH);

        // The mPEN never left the contract: it just stopped being budgeted.
        assertEq(fund.freeBalance(), 20e6);
        assertEq(fund.totalBudgeted(), 60e6);
        assertEq(pen.balanceOf(address(fund)), 80e6);
    }

    function test_release_blocksLaterClaims() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6);
        _record(cafeA, keccak256("r1"));
        fund.finalizeOriginEpoch(EPOCH);
        fund.releaseUnclaimedOrigin(EPOCH);

        assertEq(fund.pendingOriginCredit(EPOCH, cafeA), 0);
        vm.expectRevert(abi.encodeWithSelector(OriginPoolReleased.selector, EPOCH));
        fund.claimOriginCredit(EPOCH, cafeA);
    }

    function test_release_freedAmountFundsANewEpoch() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6);
        fund.finalizeOriginEpoch(EPOCH); // zero referrals: nobody can claim
        fund.releaseUnclaimedOrigin(EPOCH);

        assertEq(fund.freeBalance(), 40e6);
        fund.fundEpoch(EPOCH + 1, 40e6);
        assertEq(fund.getEpoch(EPOCH + 1).originPool, 16e6);
    }

    function test_release_requiresFinalizedAndNonEmpty() public {
        _seed(100e6);
        fund.fundEpoch(EPOCH, 100e6);

        vm.expectRevert(abi.encodeWithSelector(EpochNotFinalized.selector, EPOCH));
        fund.releaseUnclaimedOrigin(EPOCH);

        fund.finalizeOriginEpoch(EPOCH);
        fund.releaseUnclaimedOrigin(EPOCH);

        vm.expectRevert(abi.encodeWithSelector(OriginPoolReleased.selector, EPOCH));
        fund.releaseUnclaimedOrigin(EPOCH);

        fund.finalizeOriginEpoch(EPOCH + 1);
        vm.expectRevert(abi.encodeWithSelector(NothingToRelease.selector, EPOCH + 1));
        fund.releaseUnclaimedOrigin(EPOCH + 1);
    }

    function test_release_onlyOwner() public {
        fund.finalizeOriginEpoch(EPOCH);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        fund.releaseUnclaimedOrigin(EPOCH);
    }
}
