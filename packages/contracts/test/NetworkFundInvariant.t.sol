// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NetworkFund} from "../src/NetworkFund.sol";
import {CafeRegistry} from "../src/CafeRegistry.sol";
import {MockPEN} from "../src/MockPEN.sol";
import {ICafeRegistry} from "../src/interfaces/ICafeRegistry.sol";

/// @dev Drives random contribute/fund/record/finalize/claim/release/spend sequences over a
/// fixed café and epoch set, guarding each call so only state-machine-legal actions run.
contract NetworkFundHandler is Test {
    NetworkFund internal immutable fund;
    MockPEN internal immutable pen;
    address internal immutable recorder;
    address internal immutable ops;

    uint256[] internal cafeIds;
    uint256[] internal epochIds;
    uint256 internal referralNonce;

    constructor(
        NetworkFund fund_,
        MockPEN pen_,
        address recorder_,
        address ops_,
        uint256[] memory cafeIds_,
        uint256[] memory epochIds_
    ) {
        fund = fund_;
        pen = pen_;
        recorder = recorder_;
        ops = ops_;
        cafeIds = cafeIds_;
        epochIds = epochIds_;
    }

    function _epoch(uint256 seed) internal view returns (uint256) {
        return epochIds[seed % epochIds.length];
    }

    function _cafe(uint256 seed) internal view returns (uint256) {
        return cafeIds[seed % cafeIds.length];
    }

    /// @dev Mimics PlanManager's plain transfer: mPEN arrives with no call.
    function contribute(uint256 amount) external {
        amount = bound(amount, 1, 100e6);
        pen.mint(address(fund), amount);
    }

    function fundEpoch(uint256 seed, uint256 amount) external {
        uint256 epoch = _epoch(seed);
        uint256 free = fund.freeBalance();
        if (free == 0 || fund.getEpoch(epoch).finalized) return;
        amount = bound(amount, 1, free);
        fund.fundEpoch(epoch, amount);
    }

    function recordReferral(uint256 seed, uint256 cafeSeed) external {
        uint256 epoch = _epoch(seed);
        if (fund.getEpoch(epoch).finalized) return;
        referralNonce += 1;
        bytes32 referralId = keccak256(abi.encode(referralNonce));
        vm.prank(recorder);
        fund.recordReferralWithProof(epoch, _cafe(cafeSeed), referralId);
    }

    function finalize(uint256 seed) external {
        uint256 epoch = _epoch(seed);
        if (fund.getEpoch(epoch).finalized) return;
        fund.finalizeOriginEpoch(epoch);
    }

    function claim(uint256 seed, uint256 cafeSeed) external {
        uint256 epoch = _epoch(seed);
        uint256 cafeId = _cafe(cafeSeed);
        NetworkFund.Epoch memory e = fund.getEpoch(epoch);
        if (!e.finalized || e.originReleased) return;
        if (fund.originClaimed(epoch, cafeId) || fund.referrals(epoch, cafeId) == 0) return;
        fund.claimOriginCredit(epoch, cafeId);
    }

    function release(uint256 seed) external {
        uint256 epoch = _epoch(seed);
        NetworkFund.Epoch memory e = fund.getEpoch(epoch);
        if (!e.finalized || e.originReleased || e.originPool == e.originPaid) return;
        fund.releaseUnclaimedOrigin(epoch);
    }

    function allocate(uint256 seed, uint256 amount) external {
        uint256 epoch = _epoch(seed);
        uint256 crawl = fund.getEpoch(epoch).crawlPool;
        if (crawl == 0) return;
        amount = bound(amount, 1, crawl);
        fund.allocateCampaignBudget(epoch, amount);
    }

    function withdraw(uint256 seed, uint256 amount, bool contingency) external {
        uint256 epoch = _epoch(seed);
        NetworkFund.Epoch memory e = fund.getEpoch(epoch);
        uint256 available = contingency ? e.contingencyPool : e.acquisitionPool;
        if (available == 0) return;
        amount = bound(amount, 1, available);
        fund.withdrawBucket(
            epoch, contingency ? NetworkFund.Bucket.Contingency : NetworkFund.Bucket.Acquisition, ops, amount
        );
    }
}

contract NetworkFundInvariantTest is Test {
    MockPEN internal pen;
    CafeRegistry internal registry;
    NetworkFund internal fund;
    NetworkFundHandler internal handler;

    address internal admin = makeAddr("admin");
    address internal registrar = makeAddr("registrar");
    address internal recorder = makeAddr("recorder");
    address internal escrow = makeAddr("escrow");
    address internal ops = makeAddr("ops");

    uint256[] internal cafeIds;
    uint256[] internal epochIds;

    function setUp() public {
        pen = new MockPEN();
        registry = new CafeRegistry(admin);

        // Cache the role before pranking: the view call would consume a vm.prank.
        bytes32 registrarRole = registry.REGISTRAR_ROLE();
        vm.prank(admin);
        registry.grantRole(registrarRole, registrar);

        vm.startPrank(registrar);
        for (uint256 i = 0; i < 4; i++) {
            uint256 cafeId = registry.registerCafe(makeAddr(string.concat("cafeOwner", vm.toString(i))));
            registry.setCafeStatus(cafeId, ICafeRegistry.CafeStatus.Active);
            cafeIds.push(cafeId);
        }
        vm.stopPrank();

        epochIds.push(202608);
        epochIds.push(202609);
        epochIds.push(202610);

        fund = new NetworkFund(IERC20(address(pen)), registry);
        fund.setReferralRecorder(recorder);
        fund.setCampaignEscrow(escrow);

        handler = new NetworkFundHandler(fund, pen, recorder, ops, cafeIds, epochIds);
        // The handler drives owner-only ops, so it must own the fund and the faucet.
        fund.transferOwnership(address(handler));
        pen.transferOwnership(address(handler));

        targetContract(address(handler));
    }

    /// @dev Never budget more than is custodied.
    function invariant_solvent() public view {
        assertGe(pen.balanceOf(address(fund)), fund.totalBudgeted());
    }

    /// @dev The ledger never drifts from the sum of live buckets.
    function invariant_budgetMatchesBuckets() public view {
        uint256 sum;
        for (uint256 i = 0; i < epochIds.length; i++) {
            NetworkFund.Epoch memory e = fund.getEpoch(epochIds[i]);
            if (!e.originReleased) sum += e.originPool - e.originPaid;
            sum += e.acquisitionPool + e.crawlPool + e.contingencyPool;
        }
        assertEq(sum, fund.totalBudgeted());
    }

    /// @dev The prorate can never overpay its own pool.
    function invariant_originPaidWithinPool() public view {
        for (uint256 i = 0; i < epochIds.length; i++) {
            NetworkFund.Epoch memory e = fund.getEpoch(epochIds[i]);
            assertLe(e.originPaid, e.originPool);
        }
    }

    /// @dev Paid origin credit plus every tracked café's remaining credit stays within the
    /// frozen pool, including states with multiple cafés holding unclaimed credit.
    function invariant_originCreditsWithinPool() public view {
        for (uint256 i = 0; i < epochIds.length; i++) {
            uint256 epoch = epochIds[i];
            NetworkFund.Epoch memory e = fund.getEpoch(epoch);
            uint256 credits = e.originPaid;
            for (uint256 j = 0; j < cafeIds.length; j++) {
                credits += fund.pendingOriginCredit(epoch, cafeIds[j]);
            }
            assertLe(credits, e.originPool);
        }
    }
}
