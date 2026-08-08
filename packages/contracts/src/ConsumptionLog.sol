// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IConsumptionLog} from "./interfaces/IConsumptionLog.sol";
import {ICafeRegistry} from "./interfaces/ICafeRegistry.sol";
import {IPlanManager} from "./interfaces/IPlanManager.sol";
import {IPunchVault} from "./interfaces/IPunchVault.sol";

error ZeroAddress();
error InvalidLimit();
error InvalidUser();
error ProofExpired(uint256 expiry);
error ExpiryTooFar(uint256 expiry);
error TicketTooSmall(uint256 amount);
error ProductNotEligible(uint256 cafeId, uint256 productId);
error InvalidCafeSignature();
error InvalidUserSignature();
error NonceUsed(uint256 cafeId, uint256 nonce);
error ReceiptUsed(uint256 cafeId, bytes32 receiptHash);
error DailyLimitReached(uint256 cafeId, address user);

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

    /// @notice Spent nonces, scoped per café. Unordered on purpose: a strict counter
    /// would stall a café with several tills whenever transactions land out of order.
    mapping(uint256 cafeId => mapping(uint256 nonce => bool)) public nonceUsed;

    /// @notice Spent receipt hashes, scoped per café so one café cannot burn hashes
    /// another café is going to use.
    mapping(uint256 cafeId => mapping(bytes32 receiptHash => bool)) public receiptUsed;

    /// @notice Emissions per (café, user, UTC day). Fixed window, not sliding: the goal is
    /// to break a sustained farming loop (mother spec §20), not to police the midnight edge.
    mapping(uint256 cafeId => mapping(address user => mapping(uint256 day => uint256))) public dailyCount;

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
    /// @dev Permissionless: the two signatures are the authorization, the sender only
    /// pays gas. Effects land before the external calls, and PlanManager enforces plan,
    /// credit and café status, so this contract does not restate those rules. No reentrancy
    /// guard is needed: SignatureChecker uses staticcall, ECDSA.tryRecover is pure, and the
    /// state-changing external calls run after replay state is spent, so a reentrant call
    /// with the same proof reverts on NonceUsed.
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
        uint256 day = block.timestamp / 1 days;
        if (dailyCount[proof.cafeId][proof.user][day] >= maxDailyPerUserCafe) {
            revert DailyLimitReached(proof.cafeId, proof.user);
        }
        _verifySignatures(proof, cafeSignature, userSignature);

        nonceUsed[proof.cafeId][proof.nonce] = true;
        receiptUsed[proof.cafeId][proof.receiptHash] = true;
        dailyCount[proof.cafeId][proof.user][day] += 1;

        emit ConsumptionRecorded(proof.cafeId, proof.user, proof.receiptHash);

        planManager.consumeCredit(proof.cafeId);
        punchVault.issue(proof.user, proof.cafeId);
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
    function _recoverCafeSigner(bytes32 digest, bytes calldata signature) private pure returns (address) {
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError) return address(0);
        return signer;
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
