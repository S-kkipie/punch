# ConsumptionLog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `ConsumptionLog`, the single entry point for PUNCH emission: it validates a dual EIP-712 proof (café + user), enforces replay and fraud controls, and orchestrates `PlanManager.consumeCredit` followed by `PunchVault.issue`.

**Architecture:** One contract in `packages/contracts/src/ConsumptionLog.sol`, inheriting OpenZeppelin `Ownable`, `Pausable` and `EIP712`. It holds `ICafeRegistry`, `IPlanManager` and `IPunchVault` as immutables and never custodies tokens. Every call follows checks-effects-interactions: all validation reverts first, then replay state is written, then the event is emitted, then the two external calls run. `PunchVault` does not exist yet (another workstream owns it), so tests drive a `MockPunchVault` implementing the frozen `IPunchVault`; `PlanManager`, `CafeRegistry` and `MockPEN` are used for real.

**Tech Stack:** Solidity 0.8.30, Foundry (forge 1.7.1), OpenZeppelin Contracts (`@openzeppelin/contracts/`), forge-std.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-08-consumption-log-design.md`. Mother spec: `docs/superpowers/specs/2026-08-07-punch-master-spec.md`.
- Work from `packages/contracts/`. All `forge` commands run from that directory.
- **Never modify** `src/interfaces/IConsumptionLog.sol`, `src/interfaces/IPunchVault.sol`, `src/interfaces/IPlanManager.sol`, `src/interfaces/ICafeRegistry.sol`, `src/PunchVault.sol`, `src/NetworkFund.sol`, `src/CampaignEscrow.sol`, or `script/Deploy.s.sol`.
- Files this plan may touch: `src/ConsumptionLog.sol`, `test/ConsumptionLog.t.sol`, `test/ConsumptionLogInvariant.t.sol`, `script/DeployConsumptionLog.s.sol`, and one surgical deletion in `test/Scaffold.t.sol` (Task 1).
- Custom errors are **free-standing at file level**, before the contract — repo convention (see `src/PlanManager.sol`).
- Ops functions (`setMinTicketAmount`, `setMaxDailyPerUserCafe`, `pause`, `unpause`) live on the contract, **not** in the frozen interface — same pattern as `PlanManager.setConsumptionLog` and `MockPEN.mint`.
- mPEN has 6 decimals. `8e6` = S/8. `PlanManager.RESERVE_PER_CREDIT` = `300_000` = S/0.30.
- **Foundry footgun:** a view call after `vm.prank` consumes the prank. Cache view results in a local *before* pranking. See `test/PlanManager.t.sol:43-46` for the in-repo example.
- `src/PlanManager.sol` already declares a free-standing `error ZeroAddress()`. `src/ConsumptionLog.sol` declares its own. They do not collide as long as no single file imports both by name — in `test/ConsumptionLog.t.sol` import `{PlanManager}` only, and take `ZeroAddress` from `../src/ConsumptionLog.sol`.
- Baseline before starting: `forge test` passes with 97 tests. Never leave the suite red at a commit.
- Submodules must be initialized in the worktree (`git submodule update --init --recursive` from the repo root) or `forge build` fails on missing OpenZeppelin.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/ConsumptionLog.sol` | The contract: free-standing errors, EIP-712 typehash, immutables, validation, replay state, ops functions, orchestration. |
| `test/ConsumptionLog.t.sol` | `MockPunchVault` + full unit/fuzz suite. Single file, matching the repo's one-file-per-contract test convention. |
| `test/ConsumptionLogInvariant.t.sol` | Handler-driven invariant suite, mirroring `test/PlanManagerInvariant.t.sol`. |
| `script/DeployConsumptionLog.s.sol` | Env-driven deploy, mirroring `script/DeployPlanManager.s.sol`. |
| `test/Scaffold.t.sol` | Modified once, in Task 1: remove only the ConsumptionLog stub test and its imports/field/setUp line. |

Tasks build the contract in dependency order: shell → static validation → signatures → replay + orchestration → daily cap → invariants → deploy. Each task ends green and committed.

---

### Task 1: Contract shell, EIP-712 domain, and ops functions

Replaces the `NotImplemented` stub with a real contract that has its dependencies, its config levers, and its typed-data hashing — but whose `recordConsumption` body is still empty. Removing the stub breaks `test/Scaffold.t.sol` compilation (it calls `new ConsumptionLog()` with no args), so the Scaffold cleanup belongs here.

**Files:**
- Modify: `packages/contracts/src/ConsumptionLog.sol` (full rewrite of the 14-line stub)
- Modify: `packages/contracts/test/Scaffold.t.sol` (surgical deletion)
- Create: `packages/contracts/test/ConsumptionLog.t.sol`

**Interfaces:**
- Consumes: `ICafeRegistry`, `IPlanManager`, `IPunchVault` (frozen, already in `src/interfaces/`); `PlanManager`, `CafeRegistry`, `MockPEN` (already in `src/`).
- Produces:
  - `constructor(ICafeRegistry registry_, IPlanManager planManager_, IPunchVault punchVault_)`
  - `registry() / planManager() / punchVault()` public immutables
  - `minTicketAmount() / maxDailyPerUserCafe()` public `uint256`
  - `MAX_PROOF_TTL()` public constant `uint256` = 15 minutes
  - `hashProof(IConsumptionLog.ConsumptionProof calldata) external view returns (bytes32)` — full EIP-712 digest
  - `setMinTicketAmount(uint256)`, `setMaxDailyPerUserCafe(uint256)`, `pause()`, `unpause()` — all `onlyOwner`
  - Events `MinTicketAmountSet(uint256)`, `MaxDailyPerUserCafeSet(uint256)`
  - Errors `ZeroAddress()`, `InvalidLimit()`
  - Test helper produced for later tasks: `MockPunchVault` in `test/ConsumptionLog.t.sol` with `issueCount()`, `lastUser()`, `lastCafeId()`, `setShouldRevert(bool)`.

- [ ] **Step 1: Write the failing test**

Create `packages/contracts/test/ConsumptionLog.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    ConsumptionLog,
    ZeroAddress,
    InvalidLimit
} from "../src/ConsumptionLog.sol";
import {PlanManager} from "../src/PlanManager.sol";
import {CafeRegistry} from "../src/CafeRegistry.sol";
import {MockPEN} from "../src/MockPEN.sol";
import {ICafeRegistry} from "../src/interfaces/ICafeRegistry.sol";
import {IConsumptionLog} from "../src/interfaces/IConsumptionLog.sol";
import {IPunchVault} from "../src/interfaces/IPunchVault.sol";

/// @dev Stands in for the real PunchVault, which another workstream owns. Records what
/// ConsumptionLog asked for and can be told to revert, so orchestration and atomicity
/// are testable against the frozen IPunchVault.
contract MockPunchVault is IPunchVault {
    uint256 public issueCount;
    address public lastUser;
    uint256 public lastCafeId;
    bool public shouldRevert;

    error MockVaultReverted();

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function issue(address user, uint256 cafeId) external {
        if (shouldRevert) revert MockVaultReverted();
        issueCount += 1;
        lastUser = user;
        lastCafeId = cafeId;
        emit PunchIssued(user, cafeId);
    }

    function redeem(address, uint256, uint256) external {}

    function balanceOf(address) external pure returns (uint256) {
        return 0;
    }
}

contract ConsumptionLogTest is Test {
    MockPEN internal pen;
    CafeRegistry internal registry;
    PlanManager internal manager;
    MockPunchVault internal vault;
    ConsumptionLog internal log;

    address internal admin = makeAddr("admin");
    address internal registrar = makeAddr("registrar");
    address internal cafeOwner = makeAddr("cafeOwner");
    address internal networkFund = makeAddr("networkFund");
    address internal treasury = makeAddr("treasury");
    address internal stranger = makeAddr("stranger");

    address internal operator;
    uint256 internal operatorKey;
    address internal user;
    uint256 internal userKey;

    uint256 internal cafeId;
    uint256 internal constant PRODUCT_ID = 7;

    function setUp() public {
        (operator, operatorKey) = makeAddrAndKey("operator");
        (user, userKey) = makeAddrAndKey("user");

        pen = new MockPEN();
        registry = new CafeRegistry(admin);

        // Cache the role before pranking: the view call would consume a vm.prank.
        bytes32 registrarRole = registry.REGISTRAR_ROLE();
        vm.prank(admin);
        registry.grantRole(registrarRole, registrar);

        vm.startPrank(registrar);
        cafeId = registry.registerCafe(cafeOwner);
        registry.setCafeStatus(cafeId, ICafeRegistry.CafeStatus.Active);
        vm.stopPrank();

        vm.startPrank(cafeOwner);
        registry.authorizeOperator(cafeId, operator, true);
        registry.setEligibleProduct(cafeId, PRODUCT_ID, ICafeRegistry.ProductKind.Emission, true);
        vm.stopPrank();

        vault = new MockPunchVault();
        manager = new PlanManager(IERC20(address(pen)), registry, address(vault), networkFund, treasury);
        log = new ConsumptionLog(registry, manager, vault);
        manager.setConsumptionLog(address(log));

        vm.startPrank(cafeOwner);
        pen.faucet(1_000e6);
        pen.approve(address(manager), type(uint256).max);
        manager.subscribe(cafeId);
        vm.stopPrank();
    }

    function _proof(uint256 nonce) internal view returns (IConsumptionLog.ConsumptionProof memory) {
        return IConsumptionLog.ConsumptionProof({
            cafeId: cafeId,
            user: user,
            productId: PRODUCT_ID,
            amount: 12e6,
            receiptHash: keccak256(abi.encodePacked("receipt", nonce)),
            nonce: nonce,
            expiry: block.timestamp + 5 minutes
        });
    }

    function test_constructor_setsDependenciesAndDefaults() public view {
        assertEq(address(log.registry()), address(registry));
        assertEq(address(log.planManager()), address(manager));
        assertEq(address(log.punchVault()), address(vault));
        assertEq(log.minTicketAmount(), 8e6);
        assertEq(log.maxDailyPerUserCafe(), 3);
        assertEq(log.MAX_PROOF_TTL(), 15 minutes);
        assertEq(log.owner(), address(this));
    }

    function test_constructor_zeroAddressReverts() public {
        vm.expectRevert(ZeroAddress.selector);
        new ConsumptionLog(ICafeRegistry(address(0)), manager, vault);
        vm.expectRevert(ZeroAddress.selector);
        new ConsumptionLog(registry, IPlanManager(address(0)), vault);
        vm.expectRevert(ZeroAddress.selector);
        new ConsumptionLog(registry, manager, IPunchVault(address(0)));
    }

    function test_hashProof_matchesEip712Digest() public view {
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "ConsumptionProof(uint256 cafeId,address user,uint256 productId,uint256 amount,bytes32 receiptHash,uint256 nonce,uint256 expiry)"
                ),
                proof.cafeId,
                proof.user,
                proof.productId,
                proof.amount,
                proof.receiptHash,
                proof.nonce,
                proof.expiry
            )
        );
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("PUNCH ConsumptionLog")),
                keccak256(bytes("1")),
                block.chainid,
                address(log)
            )
        );
        bytes32 expected = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        assertEq(log.hashProof(proof), expected);
    }

    function test_setMinTicketAmount_ownerOnlyAndEmits() public {
        vm.expectEmit(false, false, false, true);
        emit ConsumptionLog.MinTicketAmountSet(10e6);
        log.setMinTicketAmount(10e6);
        assertEq(log.minTicketAmount(), 10e6);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        log.setMinTicketAmount(1e6);
    }

    function test_setMaxDailyPerUserCafe_ownerOnlyAndEmits() public {
        vm.expectEmit(false, false, false, true);
        emit ConsumptionLog.MaxDailyPerUserCafeSet(5);
        log.setMaxDailyPerUserCafe(5);
        assertEq(log.maxDailyPerUserCafe(), 5);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        log.setMaxDailyPerUserCafe(5);
    }

    function test_setLimits_zeroReverts() public {
        vm.expectRevert(InvalidLimit.selector);
        log.setMinTicketAmount(0);
        vm.expectRevert(InvalidLimit.selector);
        log.setMaxDailyPerUserCafe(0);
    }

    function test_pause_ownerOnly() public {
        log.pause();
        assertTrue(log.paused());
        log.unpause();
        assertFalse(log.paused());

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        log.pause();
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/contracts && forge test --match-contract ConsumptionLogTest`
Expected: compilation FAILS — `ConsumptionLog` has no constructor arguments and no `ZeroAddress`/`InvalidLimit` exports.

- [ ] **Step 3: Write the implementation**

Replace `packages/contracts/src/ConsumptionLog.sol` entirely:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IConsumptionLog} from "./interfaces/IConsumptionLog.sol";
import {ICafeRegistry} from "./interfaces/ICafeRegistry.sol";
import {IPlanManager} from "./interfaces/IPlanManager.sol";
import {IPunchVault} from "./interfaces/IPunchVault.sol";

error ZeroAddress();
error InvalidLimit();

/// @notice Single entry point for PUNCH emission. Validates a consumption proof signed by
/// both the café and the user, blocks replay, and orchestrates emission by calling
/// `PlanManager.consumeCredit` and then `PunchVault.issue`.
/// @dev Custodies no tokens and mints nothing itself. Arbitrum cannot observe the Yape
/// payment (mother spec §17), so the proof is a dual attestation, not bank evidence; the
/// controls here — nonce, expiry, receipt hash, signed product and amount, daily cap —
/// are what make that attestation expensive to forge.
contract ConsumptionLog is IConsumptionLog, Ownable, Pausable, EIP712 {
    bytes32 private constant CONSUMPTION_PROOF_TYPEHASH = keccak256(
        "ConsumptionProof(uint256 cafeId,address user,uint256 productId,uint256 amount,bytes32 receiptHash,uint256 nonce,uint256 expiry)"
    );

    /// @notice Longest window a signer may grant a proof. Without this ceiling "short
    /// expiry" would be the signer's choice, not a protocol rule (mother spec §20).
    uint256 public constant MAX_PROOF_TTL = 15 minutes;

    ICafeRegistry public immutable registry;
    IPlanManager public immutable planManager;
    IPunchVault public immutable punchVault;

    /// @notice Smallest ticket that may emit a PUNCH, in mPEN (6 decimals).
    uint256 public minTicketAmount;

    /// @notice Emissions one user may trigger at one café within a UTC day.
    uint256 public maxDailyPerUserCafe;

    event MinTicketAmountSet(uint256 amount);
    event MaxDailyPerUserCafeSet(uint256 limit);

    constructor(ICafeRegistry registry_, IPlanManager planManager_, IPunchVault punchVault_)
        Ownable(msg.sender)
        EIP712("PUNCH ConsumptionLog", "1")
    {
        if (
            address(registry_) == address(0) || address(planManager_) == address(0)
                || address(punchVault_) == address(0)
        ) revert ZeroAddress();
        registry = registry_;
        planManager = planManager_;
        punchVault = punchVault_;
        minTicketAmount = 8e6;
        maxDailyPerUserCafe = 3;
    }

    /// @inheritdoc IConsumptionLog
    function recordConsumption(
        ConsumptionProof calldata proof,
        bytes calldata cafeSignature,
        bytes calldata userSignature
    ) external {}

    /// @notice EIP-712 digest of a proof. Backend and tests sign against this rather than
    /// re-deriving the typehash, so there is one source of truth for the payload.
    function hashProof(ConsumptionProof calldata proof) external view returns (bytes32) {
        return _hashProof(proof);
    }

    /// @notice Zero is rejected: it would silently disable a fraud control. To stop
    /// emission entirely, use `pause`.
    function setMinTicketAmount(uint256 amount) external onlyOwner {
        if (amount == 0) revert InvalidLimit();
        minTicketAmount = amount;
        emit MinTicketAmountSet(amount);
    }

    /// @notice Zero is rejected for the same reason as `setMinTicketAmount`.
    function setMaxDailyPerUserCafe(uint256 limit) external onlyOwner {
        if (limit == 0) revert InvalidLimit();
        maxDailyPerUserCafe = limit;
        emit MaxDailyPerUserCafeSet(limit);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _hashProof(ConsumptionProof calldata proof) private view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    CONSUMPTION_PROOF_TYPEHASH,
                    proof.cafeId,
                    proof.user,
                    proof.productId,
                    proof.amount,
                    proof.receiptHash,
                    proof.nonce,
                    proof.expiry
                )
            )
        );
    }
}
```

- [ ] **Step 4: Remove the ConsumptionLog stub from Scaffold.t.sol**

In `packages/contracts/test/Scaffold.t.sol` delete exactly these four things and nothing else:

1. The import line `import {ConsumptionLog} from "../src/ConsumptionLog.sol";`
2. The import line `import {IConsumptionLog} from "../src/interfaces/IConsumptionLog.sol";`
3. The field `ConsumptionLog internal consumptionLog;`
4. The line `consumptionLog = new ConsumptionLog();` inside `setUp`
5. The whole `test_consumptionLog_reverts_notImplemented` function

Leave the `PunchVault`, `NetworkFund` and `CampaignEscrow` stubs and their tests untouched — other workstreams own them.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/contracts && forge test`
Expected: PASS. `ConsumptionLogTest` green; `ScaffoldTest` down to 3 tests; whole suite green (99 tests: 97 baseline − 1 removed scaffold test + 7 new).

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/ConsumptionLog.sol packages/contracts/test/ConsumptionLog.t.sol packages/contracts/test/Scaffold.t.sol
git commit -m "feat(contracts): add ConsumptionLog shell with EIP-712 domain and ops levers"
```

---

### Task 2: Static proof validation

Adds every check that needs no signature and no storage: user address, expiry window, ticket floor, product eligibility. Still no state writes, still no orchestration.

**Files:**
- Modify: `packages/contracts/src/ConsumptionLog.sol`
- Modify: `packages/contracts/test/ConsumptionLog.t.sol`

**Interfaces:**
- Consumes: Task 1's `minTicketAmount`, `maxDailyPerUserCafe`, `MAX_PROOF_TTL`, `_proof(uint256)` test helper.
- Produces: errors `InvalidUser()`, `ProofExpired(uint256 expiry)`, `ExpiryTooFar(uint256 expiry)`, `TicketTooSmall(uint256 amount)`, `ProductNotEligible(uint256 cafeId, uint256 productId)`; private `_validateProof(ConsumptionProof calldata)`.

- [ ] **Step 1: Write the failing tests**

Add to the import block at the top of `test/ConsumptionLog.t.sol` (extend the existing `ConsumptionLog` import):

```solidity
import {
    ConsumptionLog,
    ZeroAddress,
    InvalidLimit,
    InvalidUser,
    ProofExpired,
    ExpiryTooFar,
    TicketTooSmall,
    ProductNotEligible
} from "../src/ConsumptionLog.sol";
```

Append these tests to `ConsumptionLogTest`:

```solidity
    function test_recordConsumption_pausedReverts() public {
        log.pause();
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        log.recordConsumption(proof, "", "");
    }

    function test_recordConsumption_zeroUserReverts() public {
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        proof.user = address(0);
        vm.expectRevert(InvalidUser.selector);
        log.recordConsumption(proof, "", "");
    }

    function test_recordConsumption_expiredReverts() public {
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        vm.warp(proof.expiry + 1);
        vm.expectRevert(abi.encodeWithSelector(ProofExpired.selector, proof.expiry));
        log.recordConsumption(proof, "", "");
    }

    function test_recordConsumption_expiryTooFarReverts() public {
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        proof.expiry = block.timestamp + 16 minutes;
        vm.expectRevert(abi.encodeWithSelector(ExpiryTooFar.selector, proof.expiry));
        log.recordConsumption(proof, "", "");
    }

    function test_recordConsumption_ticketTooSmallReverts() public {
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        proof.amount = 8e6 - 1;
        vm.expectRevert(abi.encodeWithSelector(TicketTooSmall.selector, proof.amount));
        log.recordConsumption(proof, "", "");
    }

    function test_recordConsumption_productNotEligibleReverts() public {
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        proof.productId = 99;
        vm.expectRevert(abi.encodeWithSelector(ProductNotEligible.selector, cafeId, uint256(99)));
        log.recordConsumption(proof, "", "");
    }

    function test_recordConsumption_rewardProductNotEligibleForEmission() public {
        vm.prank(cafeOwner);
        registry.setEligibleProduct(cafeId, 42, ICafeRegistry.ProductKind.Reward, true);
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        proof.productId = 42;
        vm.expectRevert(abi.encodeWithSelector(ProductNotEligible.selector, cafeId, uint256(42)));
        log.recordConsumption(proof, "", "");
    }

    function testFuzz_recordConsumption_amountBelowFloorAlwaysReverts(uint256 amount) public {
        amount = bound(amount, 0, 8e6 - 1);
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        proof.amount = amount;
        vm.expectRevert(abi.encodeWithSelector(TicketTooSmall.selector, amount));
        log.recordConsumption(proof, "", "");
    }

    function testFuzz_recordConsumption_expiryBeyondTtlAlwaysReverts(uint256 offset) public {
        offset = bound(offset, 15 minutes + 1, 365 days);
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        proof.expiry = block.timestamp + offset;
        vm.expectRevert(abi.encodeWithSelector(ExpiryTooFar.selector, proof.expiry));
        log.recordConsumption(proof, "", "");
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/contracts && forge test --match-contract ConsumptionLogTest`
Expected: compilation FAILS — the new errors do not exist yet. After they compile, the `expectRevert` tests would FAIL because `recordConsumption` is a no-op.

- [ ] **Step 3: Write the implementation**

In `src/ConsumptionLog.sol`, add to the free-standing error block:

```solidity
error InvalidUser();
error ProofExpired(uint256 expiry);
error ExpiryTooFar(uint256 expiry);
error TicketTooSmall(uint256 amount);
error ProductNotEligible(uint256 cafeId, uint256 productId);
```

Replace the empty `recordConsumption` body and add the private validator:

```solidity
    /// @inheritdoc IConsumptionLog
    function recordConsumption(
        ConsumptionProof calldata proof,
        bytes calldata cafeSignature,
        bytes calldata userSignature
    ) external whenNotPaused {
        _validateProof(proof);
    }

    /// @dev Cheapest checks first, and all of them before any state write
    /// (checks-effects-interactions, mother spec §20).
    function _validateProof(ConsumptionProof calldata proof) private view {
        if (proof.user == address(0)) revert InvalidUser();
        if (block.timestamp > proof.expiry) revert ProofExpired(proof.expiry);
        if (proof.expiry > block.timestamp + MAX_PROOF_TTL) revert ExpiryTooFar(proof.expiry);
        if (proof.amount < minTicketAmount) revert TicketTooSmall(proof.amount);
        if (!registry.isEligible(proof.cafeId, proof.productId, ICafeRegistry.ProductKind.Emission)) {
            revert ProductNotEligible(proof.cafeId, proof.productId);
        }
    }
```

Leave `cafeSignature` and `userSignature` unnamed-but-present for now; the compiler warns about unused parameters, which Task 3 resolves.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/contracts && forge test --match-contract ConsumptionLogTest`
Expected: PASS, all tests including the two fuzz tests.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/ConsumptionLog.sol packages/contracts/test/ConsumptionLog.t.sol
git commit -m "feat(contracts): validate proof expiry, ticket floor and product eligibility"
```

---

### Task 3: Dual EIP-712 signature verification

**Files:**
- Modify: `packages/contracts/src/ConsumptionLog.sol`
- Modify: `packages/contracts/test/ConsumptionLog.t.sol`

**Interfaces:**
- Consumes: `hashProof`, `_validateProof` from Tasks 1–2.
- Produces: errors `InvalidCafeSignature()`, `InvalidUserSignature()`; private `_verifySignatures(ConsumptionProof calldata, bytes calldata, bytes calldata)`; test helper `_sign(uint256 privateKey, IConsumptionLog.ConsumptionProof memory) returns (bytes memory)`.

- [ ] **Step 1: Write the failing tests**

Extend the `ConsumptionLog` import with `InvalidCafeSignature` and `InvalidUserSignature`, and add these imports at the top of the test file:

```solidity
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
```

Add this contract above `ConsumptionLogTest` in the test file:

```solidity
/// @dev Minimal EIP-1271 smart account: approves a fixed digest, rejects everything else.
/// Stands in for the post-MVP passkey / account-abstraction user (mother spec §20).
contract MockSmartAccount is IERC1271 {
    bytes32 public approvedDigest;

    function approve(bytes32 digest) external {
        approvedDigest = digest;
    }

    function isValidSignature(bytes32 digest, bytes memory) external view returns (bytes4) {
        return digest == approvedDigest ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }
}
```

Add the signing helper and the tests to `ConsumptionLogTest`:

```solidity
    function _sign(uint256 privateKey, IConsumptionLog.ConsumptionProof memory proof)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = log.hashProof(proof);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_recordConsumption_badCafeSignatureReverts() public {
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        (, uint256 strangerKey) = makeAddrAndKey("strangerSigner");
        bytes memory cafeSig = _sign(strangerKey, proof);
        bytes memory userSig = _sign(userKey, proof);
        vm.expectRevert(InvalidCafeSignature.selector);
        log.recordConsumption(proof, cafeSig, userSig);
    }

    function test_recordConsumption_revokedOperatorReverts() public {
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        bytes memory cafeSig = _sign(operatorKey, proof);
        bytes memory userSig = _sign(userKey, proof);

        vm.prank(cafeOwner);
        registry.authorizeOperator(cafeId, operator, false);

        vm.expectRevert(InvalidCafeSignature.selector);
        log.recordConsumption(proof, cafeSig, userSig);
    }

    function test_recordConsumption_badUserSignatureReverts() public {
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        (, uint256 otherKey) = makeAddrAndKey("otherUser");
        bytes memory cafeSig = _sign(operatorKey, proof);
        bytes memory userSig = _sign(otherKey, proof);
        vm.expectRevert(InvalidUserSignature.selector);
        log.recordConsumption(proof, cafeSig, userSig);
    }

    function test_recordConsumption_mutatedProofReverts() public {
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        bytes memory cafeSig = _sign(operatorKey, proof);
        bytes memory userSig = _sign(userKey, proof);
        proof.amount = 50e6; // raised after both parties signed
        vm.expectRevert(InvalidCafeSignature.selector);
        log.recordConsumption(proof, cafeSig, userSig);
    }

    function test_recordConsumption_eip1271UserRejected() public {
        MockSmartAccount account = new MockSmartAccount();
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        proof.user = address(account);
        // No approve call: the account rejects the digest.
        bytes memory cafeSig = _sign(operatorKey, proof);
        vm.expectRevert(InvalidUserSignature.selector);
        log.recordConsumption(proof, cafeSig, "");
    }
```

Every test in this task asserts an exact revert selector. The happy-path counterparts — a café owner's signature accepted, an EIP-1271 signature accepted — live in Task 4, where emission actually completes and success can be asserted precisely instead of by a bare `vm.expectRevert()`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/contracts && forge test --match-contract ConsumptionLogTest`
Expected: compilation FAILS — `InvalidCafeSignature` / `InvalidUserSignature` do not exist.

- [ ] **Step 3: Write the implementation**

Add the import to `src/ConsumptionLog.sol`:

```solidity
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
```

Add to the error block:

```solidity
error InvalidCafeSignature();
error InvalidUserSignature();
```

Add the verifier and call it from `recordConsumption`:

```solidity
    /// @inheritdoc IConsumptionLog
    function recordConsumption(
        ConsumptionProof calldata proof,
        bytes calldata cafeSignature,
        bytes calldata userSignature
    ) external whenNotPaused {
        _validateProof(proof);
        _verifySignatures(proof, cafeSignature, userSignature);
    }

    /// @dev The two signatures are the only authorization: anyone may submit the
    /// transaction, so a compromised relayer can withhold emissions but never forge one
    /// (mother spec §20). `SignatureChecker` accepts EOA and EIP-1271 signatures, so the
    /// custodial MVP and a future smart-account user both work without a redeploy.
    function _verifySignatures(
        ConsumptionProof calldata proof,
        bytes calldata cafeSignature,
        bytes calldata userSignature
    ) private view {
        bytes32 digest = _hashProof(proof);
        address cafeSigner = _recoverCafeSigner(digest, cafeSignature);
        if (cafeSigner == address(0) || !registry.isAuthorized(proof.cafeId, cafeSigner)) {
            revert InvalidCafeSignature();
        }
        if (!SignatureChecker.isValidSignatureNow(proof.user, digest, userSignature)) {
            revert InvalidUserSignature();
        }
    }

    /// @dev The café side needs the signer's identity (to ask the registry about it), not
    /// just a yes/no, so it recovers rather than using SignatureChecker. Café-side keys
    /// are operator EOAs registered in CafeRegistry.
    function _recoverCafeSigner(bytes32 digest, bytes calldata signature)
        private
        pure
        returns (address)
    {
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError) return address(0);
        return signer;
    }
```

Add the `ECDSA` import too:

```solidity
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/contracts && forge test --match-contract ConsumptionLogTest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/ConsumptionLog.sol packages/contracts/test/ConsumptionLog.t.sol
git commit -m "feat(contracts): verify dual EIP-712 café and user signatures"
```

---

### Task 4: Replay guards and emission orchestration

The core of the contract: nonce and receipt-hash consumption, the `ConsumptionRecorded` event, and the two external calls that actually emit a PUNCH.

**Files:**
- Modify: `packages/contracts/src/ConsumptionLog.sol`
- Modify: `packages/contracts/test/ConsumptionLog.t.sol`

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: errors `NonceUsed(uint256 cafeId, uint256 nonce)`, `ReceiptUsed(uint256 cafeId, bytes32 receiptHash)`; public mappings `nonceUsed(uint256,uint256) returns (bool)`, `receiptUsed(uint256,bytes32) returns (bool)`; test helper `_record(uint256 nonce)`.

- [ ] **Step 1: Write the failing tests**

Extend the `ConsumptionLog` import with `NonceUsed` and `ReceiptUsed`, and add this import:

```solidity
import {IPlanManager} from "../src/interfaces/IPlanManager.sol";
import {PlanNotActive} from "../src/PlanManager.sol";
```

Add the happy-path signature tests deferred from Task 3, now that emission completes and success is assertable:

```solidity
    function test_recordConsumption_cafeOwnerSignatureAccepted() public {
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        (address ownerSigner, uint256 ownerKey) = makeAddrAndKey("cafeOwnerSigner");
        vm.prank(registrar);
        uint256 otherCafe = registry.registerCafe(ownerSigner);
        vm.prank(registrar);
        registry.setCafeStatus(otherCafe, ICafeRegistry.CafeStatus.Active);
        vm.prank(ownerSigner);
        registry.setEligibleProduct(otherCafe, PRODUCT_ID, ICafeRegistry.ProductKind.Emission, true);

        proof.cafeId = otherCafe;
        bytes memory cafeSig = _sign(ownerKey, proof);
        bytes memory userSig = _sign(userKey, proof);
        // Signatures pass; PlanManager stops it because that café never subscribed.
        vm.expectRevert(abi.encodeWithSelector(PlanNotActive.selector, otherCafe));
        log.recordConsumption(proof, cafeSig, userSig);
    }

    function test_recordConsumption_eip1271UserAccepted() public {
        MockSmartAccount account = new MockSmartAccount();
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        proof.user = address(account);
        account.approve(log.hashProof(proof));

        bytes memory cafeSig = _sign(operatorKey, proof);
        log.recordConsumption(proof, cafeSig, "");

        assertEq(vault.issueCount(), 1);
        assertEq(vault.lastUser(), address(account));
    }
```

Add the helper and the new tests:

```solidity
    function _record(uint256 nonce) internal returns (IConsumptionLog.ConsumptionProof memory proof) {
        proof = _proof(nonce);
        bytes memory cafeSig = _sign(operatorKey, proof);
        bytes memory userSig = _sign(userKey, proof);
        log.recordConsumption(proof, cafeSig, userSig);
    }

    function test_recordConsumption_happyPath() public {
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        bytes memory cafeSig = _sign(operatorKey, proof);
        bytes memory userSig = _sign(userKey, proof);

        uint256 creditsBefore = manager.credits(cafeId);
        uint256 vaultPenBefore = pen.balanceOf(address(vault));

        vm.expectEmit(true, true, true, false);
        emit IConsumptionLog.ConsumptionRecorded(cafeId, user, proof.receiptHash);
        vm.prank(stranger); // permissionless relayer
        log.recordConsumption(proof, cafeSig, userSig);

        assertEq(vault.issueCount(), 1);
        assertEq(vault.lastUser(), user);
        assertEq(vault.lastCafeId(), cafeId);
        assertEq(manager.credits(cafeId), creditsBefore - 1);
        assertEq(pen.balanceOf(address(vault)) - vaultPenBefore, 300_000);
        assertTrue(log.nonceUsed(cafeId, 1));
        assertTrue(log.receiptUsed(cafeId, proof.receiptHash));
    }

    function test_recordConsumption_expiryAtDeadlineStillValid() public {
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        bytes memory cafeSig = _sign(operatorKey, proof);
        bytes memory userSig = _sign(userKey, proof);

        vm.warp(proof.expiry); // exactly at the deadline: inclusive, still valid
        log.recordConsumption(proof, cafeSig, userSig);

        assertEq(vault.issueCount(), 1);
    }

    function test_recordConsumption_replaySameProofReverts() public {
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        bytes memory cafeSig = _sign(operatorKey, proof);
        bytes memory userSig = _sign(userKey, proof);
        log.recordConsumption(proof, cafeSig, userSig);

        vm.expectRevert(abi.encodeWithSelector(NonceUsed.selector, cafeId, uint256(1)));
        log.recordConsumption(proof, cafeSig, userSig);
    }

    function test_recordConsumption_reusedReceiptWithNewNonceReverts() public {
        IConsumptionLog.ConsumptionProof memory first = _record(1);

        IConsumptionLog.ConsumptionProof memory proof = _proof(2);
        proof.receiptHash = first.receiptHash;
        bytes memory cafeSig = _sign(operatorKey, proof);
        bytes memory userSig = _sign(userKey, proof);

        vm.expectRevert(abi.encodeWithSelector(ReceiptUsed.selector, cafeId, first.receiptHash));
        log.recordConsumption(proof, cafeSig, userSig);
    }

    function test_recordConsumption_noncesAreOutOfOrder() public {
        _record(500);
        _record(3);
        _record(42);
        assertEq(vault.issueCount(), 3);
    }

    function test_recordConsumption_nonceAndReceiptScopedPerCafe() public {
        IConsumptionLog.ConsumptionProof memory first = _record(1);

        // A second café reusing the exact same nonce and receiptHash must succeed.
        (address otherOperator, uint256 otherOperatorKey) = makeAddrAndKey("otherOperator");
        vm.prank(registrar);
        uint256 otherCafe = registry.registerCafe(cafeOwner);
        vm.prank(registrar);
        registry.setCafeStatus(otherCafe, ICafeRegistry.CafeStatus.Active);
        vm.startPrank(cafeOwner);
        registry.authorizeOperator(otherCafe, otherOperator, true);
        registry.setEligibleProduct(otherCafe, PRODUCT_ID, ICafeRegistry.ProductKind.Emission, true);
        manager.subscribe(otherCafe);
        vm.stopPrank();

        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        proof.cafeId = otherCafe;
        proof.receiptHash = first.receiptHash;
        bytes memory cafeSig = _sign(otherOperatorKey, proof);
        bytes memory userSig = _sign(userKey, proof);
        log.recordConsumption(proof, cafeSig, userSig);

        assertEq(vault.issueCount(), 2);
    }

    function test_recordConsumption_vaultRevertRollsBackCredit() public {
        vault.setShouldRevert(true);
        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        bytes memory cafeSig = _sign(operatorKey, proof);
        bytes memory userSig = _sign(userKey, proof);

        uint256 creditsBefore = manager.credits(cafeId);
        vm.expectRevert(MockPunchVault.MockVaultReverted.selector);
        log.recordConsumption(proof, cafeSig, userSig);

        assertEq(manager.credits(cafeId), creditsBefore);
        assertFalse(log.nonceUsed(cafeId, 1));
        assertFalse(log.receiptUsed(cafeId, proof.receiptHash));
    }

    function test_recordConsumption_planCancelledReverts() public {
        vm.prank(cafeOwner);
        manager.cancel(cafeId);

        IConsumptionLog.ConsumptionProof memory proof = _proof(1);
        bytes memory cafeSig = _sign(operatorKey, proof);
        bytes memory userSig = _sign(userKey, proof);
        vm.expectRevert(abi.encodeWithSelector(PlanNotActive.selector, cafeId));
        log.recordConsumption(proof, cafeSig, userSig);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/contracts && forge test --match-contract ConsumptionLogTest`
Expected: compilation FAILS — `NonceUsed`, `ReceiptUsed`, `log.nonceUsed`, `log.receiptUsed` do not exist.

- [ ] **Step 3: Write the implementation**

Add to the error block in `src/ConsumptionLog.sol`:

```solidity
error NonceUsed(uint256 cafeId, uint256 nonce);
error ReceiptUsed(uint256 cafeId, bytes32 receiptHash);
```

Add the storage below `maxDailyPerUserCafe`:

```solidity
    /// @notice Spent nonces, scoped per café. Unordered on purpose: a strict counter
    /// would stall a café with several tills whenever transactions land out of order.
    mapping(uint256 cafeId => mapping(uint256 nonce => bool)) public nonceUsed;

    /// @notice Spent receipt hashes, scoped per café so one café cannot burn hashes
    /// another café is going to use.
    mapping(uint256 cafeId => mapping(bytes32 receiptHash => bool)) public receiptUsed;
```

Complete `recordConsumption`:

```solidity
    /// @inheritdoc IConsumptionLog
    /// @dev Permissionless: the two signatures are the authorization, the sender only
    /// pays gas. Effects land before the external calls, and PlanManager enforces plan,
    /// credit and café status, so this contract does not restate those rules.
    function recordConsumption(
        ConsumptionProof calldata proof,
        bytes calldata cafeSignature,
        bytes calldata userSignature
    ) external whenNotPaused {
        _validateProof(proof);
        if (nonceUsed[proof.cafeId][proof.nonce]) revert NonceUsed(proof.cafeId, proof.nonce);
        if (receiptUsed[proof.cafeId][proof.receiptHash]) {
            revert ReceiptUsed(proof.cafeId, proof.receiptHash);
        }
        _verifySignatures(proof, cafeSignature, userSignature);

        nonceUsed[proof.cafeId][proof.nonce] = true;
        receiptUsed[proof.cafeId][proof.receiptHash] = true;

        emit ConsumptionRecorded(proof.cafeId, proof.user, proof.receiptHash);

        planManager.consumeCredit(proof.cafeId);
        punchVault.issue(proof.user, proof.cafeId);
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/contracts && forge test --match-contract ConsumptionLogTest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/ConsumptionLog.sol packages/contracts/test/ConsumptionLog.t.sol
git commit -m "feat(contracts): guard replay and orchestrate credit consumption and issuance"
```

---

### Task 5: Daily cap per user and café

**Files:**
- Modify: `packages/contracts/src/ConsumptionLog.sol`
- Modify: `packages/contracts/test/ConsumptionLog.t.sol`

**Interfaces:**
- Consumes: `maxDailyPerUserCafe`, `_record(uint256)`.
- Produces: error `DailyLimitReached(uint256 cafeId, address user)`; public mapping `dailyCount(uint256,address,uint256) returns (uint256)`.

- [ ] **Step 1: Write the failing tests**

Extend the `ConsumptionLog` import with `DailyLimitReached` and add:

```solidity
    function test_recordConsumption_dailyCapBlocksFourth() public {
        _record(1);
        _record(2);
        _record(3);

        IConsumptionLog.ConsumptionProof memory proof = _proof(4);
        bytes memory cafeSig = _sign(operatorKey, proof);
        bytes memory userSig = _sign(userKey, proof);
        vm.expectRevert(abi.encodeWithSelector(DailyLimitReached.selector, cafeId, user));
        log.recordConsumption(proof, cafeSig, userSig);

        assertEq(log.dailyCount(cafeId, user, block.timestamp / 1 days), 3);
        assertEq(vault.issueCount(), 3);
    }

    function test_recordConsumption_dailyCapResetsNextDay() public {
        _record(1);
        _record(2);
        _record(3);

        vm.warp(block.timestamp + 1 days);
        _record(4);
        assertEq(vault.issueCount(), 4);
    }

    function test_recordConsumption_dailyCapIsPerCafe() public {
        _record(1);
        _record(2);
        _record(3);

        (address otherOperator, uint256 otherOperatorKey) = makeAddrAndKey("otherOperator2");
        vm.prank(registrar);
        uint256 otherCafe = registry.registerCafe(cafeOwner);
        vm.prank(registrar);
        registry.setCafeStatus(otherCafe, ICafeRegistry.CafeStatus.Active);
        vm.startPrank(cafeOwner);
        registry.authorizeOperator(otherCafe, otherOperator, true);
        registry.setEligibleProduct(otherCafe, PRODUCT_ID, ICafeRegistry.ProductKind.Emission, true);
        manager.subscribe(otherCafe);
        vm.stopPrank();

        IConsumptionLog.ConsumptionProof memory proof = _proof(10);
        proof.cafeId = otherCafe;
        bytes memory cafeSig = _sign(otherOperatorKey, proof);
        bytes memory userSig = _sign(userKey, proof);
        log.recordConsumption(proof, cafeSig, userSig);

        assertEq(vault.issueCount(), 4);
    }

    function test_recordConsumption_dailyCapIsPerUser() public {
        _record(1);
        _record(2);
        _record(3);

        (address otherUser, uint256 otherUserKey) = makeAddrAndKey("otherUser2");
        IConsumptionLog.ConsumptionProof memory proof = _proof(11);
        proof.user = otherUser;
        bytes memory cafeSig = _sign(operatorKey, proof);
        bytes memory userSig = _sign(otherUserKey, proof);
        log.recordConsumption(proof, cafeSig, userSig);

        assertEq(vault.issueCount(), 4);
    }

    function test_recordConsumption_raisedCapTakesEffect() public {
        _record(1);
        _record(2);
        _record(3);
        log.setMaxDailyPerUserCafe(4);
        _record(4);
        assertEq(vault.issueCount(), 4);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/contracts && forge test --match-contract ConsumptionLogTest`
Expected: compilation FAILS — `DailyLimitReached` and `dailyCount` do not exist.

- [ ] **Step 3: Write the implementation**

Add to the error block:

```solidity
error DailyLimitReached(uint256 cafeId, address user);
```

Add the storage:

```solidity
    /// @notice Emissions per (café, user, UTC day). Fixed window, not sliding: the goal is
    /// to break a sustained farming loop (mother spec §20), not to police the midnight edge.
    mapping(uint256 cafeId => mapping(address user => mapping(uint256 day => uint256))) public
        dailyCount;
```

In `recordConsumption`, add the check after the receipt check and before `_verifySignatures`, and the increment alongside the other effects:

```solidity
        uint256 day = block.timestamp / 1 days;
        if (dailyCount[proof.cafeId][proof.user][day] >= maxDailyPerUserCafe) {
            revert DailyLimitReached(proof.cafeId, proof.user);
        }
        _verifySignatures(proof, cafeSignature, userSignature);

        nonceUsed[proof.cafeId][proof.nonce] = true;
        receiptUsed[proof.cafeId][proof.receiptHash] = true;
        dailyCount[proof.cafeId][proof.user][day] += 1;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/contracts && forge test`
Expected: PASS, whole suite.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/ConsumptionLog.sol packages/contracts/test/ConsumptionLog.t.sol
git commit -m "feat(contracts): cap daily emissions per user and café"
```

---

### Task 6: Invariant suite

**Files:**
- Create: `packages/contracts/test/ConsumptionLogInvariant.t.sol`

**Interfaces:**
- Consumes: the finished `ConsumptionLog`, `MockPunchVault` (re-declared locally to keep the file self-contained — this file must not import from `ConsumptionLog.t.sol`).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the invariant suite**

Create `packages/contracts/test/ConsumptionLogInvariant.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ConsumptionLog} from "../src/ConsumptionLog.sol";
import {PlanManager} from "../src/PlanManager.sol";
import {CafeRegistry} from "../src/CafeRegistry.sol";
import {MockPEN} from "../src/MockPEN.sol";
import {ICafeRegistry} from "../src/interfaces/ICafeRegistry.sol";
import {IConsumptionLog} from "../src/interfaces/IConsumptionLog.sol";
import {IPunchVault} from "../src/interfaces/IPunchVault.sol";

/// @dev Counts issuance so invariants can compare it against credits consumed.
contract CountingVault is IPunchVault {
    uint256 public issueCount;

    function issue(address user, uint256 cafeId) external {
        issueCount += 1;
        emit PunchIssued(user, cafeId);
    }

    function redeem(address, uint256, uint256) external {}

    function balanceOf(address) external pure returns (uint256) {
        return 0;
    }
}

/// @dev Fires random proofs — valid and malformed — at ConsumptionLog over a small café
/// and user set, swallowing reverts so the fuzzer explores rejected paths too. Ghost
/// counters record what actually succeeded.
contract ConsumptionLogHandler is Test {
    ConsumptionLog internal immutable log;
    PlanManager internal immutable manager;
    CountingVault internal immutable vault;

    uint256[] internal cafeIds;
    uint256[] internal operatorKeys;
    uint256[] internal userKeys;

    uint256 public successfulRecords;

    constructor(
        ConsumptionLog log_,
        PlanManager manager_,
        CountingVault vault_,
        uint256[] memory cafeIds_,
        uint256[] memory operatorKeys_,
        uint256[] memory userKeys_
    ) {
        log = log_;
        manager = manager_;
        vault = vault_;
        cafeIds = cafeIds_;
        operatorKeys = operatorKeys_;
        userKeys = userKeys_;
    }

    function record(uint256 cafeSeed, uint256 userSeed, uint256 nonce, uint256 amount, bool validCafeSig)
        external
    {
        uint256 i = cafeSeed % cafeIds.length;
        uint256 j = userSeed % userKeys.length;
        uint256 userKey = userKeys[j];

        IConsumptionLog.ConsumptionProof memory proof = IConsumptionLog.ConsumptionProof({
            cafeId: cafeIds[i],
            user: vm.addr(userKey),
            productId: 1,
            amount: bound(amount, 1e6, 100e6),
            receiptHash: keccak256(abi.encodePacked(cafeIds[i], nonce)),
            nonce: nonce,
            expiry: block.timestamp + 1 minutes
        });

        bytes32 digest = log.hashProof(proof);
        uint256 cafeKey = validCafeSig ? operatorKeys[i] : userKey;
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(cafeKey, digest);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(userKey, digest);

        try log.recordConsumption(proof, abi.encodePacked(r1, s1, v1), abi.encodePacked(r2, s2, v2)) {
            successfulRecords += 1;
        } catch {}
    }

    function warp(uint256 secondsAhead) external {
        vm.warp(block.timestamp + bound(secondsAhead, 1, 2 days));
    }

    function cafeIdAt(uint256 i) external view returns (uint256) {
        return cafeIds[i];
    }

    function userAt(uint256 i) external view returns (address) {
        return vm.addr(userKeys[i]);
    }

    function cafeCount() external view returns (uint256) {
        return cafeIds.length;
    }

    function userCount() external view returns (uint256) {
        return userKeys.length;
    }
}

contract ConsumptionLogInvariantTest is Test {
    MockPEN internal pen;
    CafeRegistry internal registry;
    PlanManager internal manager;
    CountingVault internal vault;
    ConsumptionLog internal log;
    ConsumptionLogHandler internal handler;

    address internal admin = makeAddr("admin");
    address internal registrar = makeAddr("registrar");
    address internal networkFund = makeAddr("networkFund");
    address internal treasury = makeAddr("treasury");

    uint256 internal totalCreditsBought;

    function setUp() public {
        pen = new MockPEN();
        registry = new CafeRegistry(admin);

        bytes32 registrarRole = registry.REGISTRAR_ROLE();
        vm.prank(admin);
        registry.grantRole(registrarRole, registrar);

        vault = new CountingVault();
        manager = new PlanManager(IERC20(address(pen)), registry, address(vault), networkFund, treasury);
        log = new ConsumptionLog(registry, manager, vault);
        manager.setConsumptionLog(address(log));

        uint256[] memory cafeIds = new uint256[](3);
        uint256[] memory operatorKeys = new uint256[](3);
        for (uint256 i = 0; i < 3; i++) {
            (address cafeOwner,) = makeAddrAndKey(string.concat("owner", vm.toString(i)));
            (address operator, uint256 operatorKey) =
                makeAddrAndKey(string.concat("operator", vm.toString(i)));
            operatorKeys[i] = operatorKey;

            vm.startPrank(registrar);
            cafeIds[i] = registry.registerCafe(cafeOwner);
            registry.setCafeStatus(cafeIds[i], ICafeRegistry.CafeStatus.Active);
            vm.stopPrank();

            vm.startPrank(cafeOwner);
            registry.authorizeOperator(cafeIds[i], operator, true);
            registry.setEligibleProduct(cafeIds[i], 1, ICafeRegistry.ProductKind.Emission, true);
            pen.faucet(1_000e6);
            pen.approve(address(manager), type(uint256).max);
            manager.subscribe(cafeIds[i]);
            vm.stopPrank();
            totalCreditsBought += 100;
        }

        uint256[] memory userKeys = new uint256[](2);
        (, userKeys[0]) = makeAddrAndKey("invUser0");
        (, userKeys[1]) = makeAddrAndKey("invUser1");

        handler = new ConsumptionLogHandler(log, manager, vault, cafeIds, operatorKeys, userKeys);
        targetContract(address(handler));
    }

    /// @dev Invariant 2 of the mother spec: one valid purchase, exactly one PUNCH.
    function invariant_issuanceMatchesCreditsConsumed() public view {
        uint256 creditsLeft;
        for (uint256 i = 0; i < handler.cafeCount(); i++) {
            creditsLeft += manager.credits(handler.cafeIdAt(i));
        }
        assertEq(vault.issueCount(), totalCreditsBought - creditsLeft);
        assertEq(vault.issueCount(), handler.successfulRecords());
    }

    /// @dev Invariant 9: every live PUNCH is backed by S/0.30 in the vault.
    function invariant_vaultReserveMatchesIssuance() public view {
        assertEq(pen.balanceOf(address(vault)), vault.issueCount() * 300_000);
    }

    /// @dev The daily cap is never exceeded for any (café, user) pair on the current day.
    function invariant_dailyCapNeverExceeded() public view {
        uint256 day = block.timestamp / 1 days;
        uint256 cap = log.maxDailyPerUserCafe();
        for (uint256 i = 0; i < handler.cafeCount(); i++) {
            for (uint256 j = 0; j < handler.userCount(); j++) {
                assertLe(log.dailyCount(handler.cafeIdAt(i), handler.userAt(j), day), cap);
            }
        }
    }
}
```

- [ ] **Step 2: Run the invariant suite**

Run: `cd packages/contracts && forge test --match-contract ConsumptionLogInvariantTest -vv`
Expected: PASS, 3 invariants. It takes a couple of minutes, like `PlanManagerInvariant`.

If `invariant_issuanceMatchesCreditsConsumed` fails, do not weaken the assertion — that would be hiding a real emission-accounting bug. Debug it with `superpowers:systematic-debugging`.

- [ ] **Step 3: Run the whole suite**

Run: `cd packages/contracts && forge test`
Expected: PASS, everything green.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/test/ConsumptionLogInvariant.t.sol
git commit -m "test(contracts): add ConsumptionLog invariant suite"
```

---

### Task 7: Deploy script

**Files:**
- Create: `packages/contracts/script/DeployConsumptionLog.s.sol`

**Interfaces:**
- Consumes: the finished `ConsumptionLog` constructor.
- Produces: `DeployConsumptionLog.run() returns (ConsumptionLog log)`.

- [ ] **Step 1: Write the script**

Create `packages/contracts/script/DeployConsumptionLog.s.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {ConsumptionLog} from "../src/ConsumptionLog.sol";
import {ICafeRegistry} from "../src/interfaces/ICafeRegistry.sol";
import {IPlanManager} from "../src/interfaces/IPlanManager.sol";
import {IPunchVault} from "../src/interfaces/IPunchVault.sol";

/// @notice Deploys ConsumptionLog. Emission stays off until the PlanManager owner runs
/// `planManager.setConsumptionLog(address(log))` — a separate transaction this script
/// deliberately does not send, since the broadcaster is not necessarily that owner.
contract DeployConsumptionLog is Script {
    function run() external returns (ConsumptionLog log) {
        ICafeRegistry registry = ICafeRegistry(vm.envAddress("CAFE_REGISTRY_ADDRESS"));
        IPlanManager planManager = IPlanManager(vm.envAddress("PLAN_MANAGER_ADDRESS"));
        IPunchVault punchVault = IPunchVault(vm.envAddress("PUNCH_VAULT_ADDRESS"));

        vm.startBroadcast();
        log = new ConsumptionLog(registry, planManager, punchVault);
        vm.stopBroadcast();
    }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd packages/contracts && forge build`
Expected: compiles with no errors.

- [ ] **Step 3: Confirm the shared deploy script was not touched**

Run: `git status --short packages/contracts/script/`
Expected: only `DeployConsumptionLog.s.sol` shows as new. `Deploy.s.sol` must not appear.

- [ ] **Step 4: Run the full suite one last time**

Run: `cd packages/contracts && forge test`
Expected: PASS, everything green.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/script/DeployConsumptionLog.s.sol
git commit -m "feat(contracts): add ConsumptionLog deploy script"
```

---

## Definition of Done

- `forge fmt` run before the final commit, then `forge test` green and `forge build` clean.
- `git diff main --stat` touches only: `src/ConsumptionLog.sol`, `test/ConsumptionLog.t.sol`, `test/ConsumptionLogInvariant.t.sol`, `script/DeployConsumptionLog.s.sol`, `test/Scaffold.t.sol`, and the two docs files.
- `src/interfaces/*`, `src/PunchVault.sol`, `src/NetworkFund.sol`, `src/CampaignEscrow.sol` and `script/Deploy.s.sol` are unchanged.
- Every spec section maps to a task: EIP-712 domain and `hashProof` (T1), expiry ceiling / ticket floor / product eligibility (T2), dual signatures with EIP-1271 (T3), per-café nonce and receipt scoping plus orchestration and atomicity (T4), daily cap (T5), invariants (T6), deploy and wiring note (T7).
