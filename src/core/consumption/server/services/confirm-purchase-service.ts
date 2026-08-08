import "server-only";
import { chain as chainConfig } from "@/core/chain/chain";
import { assignWallet } from "@/core/chain/server/wallet/assign-wallet";
import { deriveUserAccount } from "@/core/chain/server/wallet/derive";
import {
    PURCHASE_PROOF_TYPES,
    type PurchaseProofMessage,
    purchaseProofDomain,
} from "@/core/consumption/domain/eip712";
import type { ConfirmPurchase } from "@/core/consumption/domain/types";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import type { ChainSubmission } from "../chain-port";
import { DEMO_CONSUMPTION_VERIFIER_ADDRESS } from "../demo-chain-context";
import { PostgresMockConsumerChain } from "../postgres-mock-chain";
import { bindProofSignatures, findProofById } from "../repository/proofs";

export async function confirmPurchaseService(
    consumerUserId: string,
    input: ConfirmPurchase,
): AsyncAppResult<ChainSubmission> {
    const proof = await findProofById(input.proofId);
    if (!proof) return err(AppErrors.notFound({ targets: ["proofId"] }));
    if (proof.status !== "issued") {
        if (
            proof.status === "confirmed" &&
            proof.consumerUserId === consumerUserId
        ) {
            try {
                return ok(
                    await new PostgresMockConsumerChain().submitConsumption({
                        proofId: proof.id,
                        idempotencyKey: `emission:${proof.id}`,
                    }),
                );
            } catch {
                return err(
                    AppErrors.unprocessableEntity({
                        targets: ["proofId"],
                        cause: "No se pudo confirmar la compra. Inténtalo de nuevo.",
                    }),
                );
            }
        }
        return err(
            AppErrors.unprocessableEntity({
                targets: ["proofId"],
                cause: "Este comprobante ya fue confirmado o no está disponible.",
            }),
        );
    }
    if (proof.expiresAt.getTime() <= Date.now()) {
        return err(
            AppErrors.unprocessableEntity({
                targets: ["proofId"],
                cause: "Pide al barista uno nuevo.",
            }),
        );
    }

    try {
        // Assign both wallets before deriving either signing account. The final
        // payload intentionally contains the consumer address for both signatures.
        const consumerWallet = await assignWallet(consumerUserId);
        const cafeWallet = await assignWallet(proof.issuedByUserId);
        const consumerAccount = deriveUserAccount(consumerWallet.walletIndex);
        const cafeAccount = deriveUserAccount(cafeWallet.walletIndex);
        const verifyingContract = DEMO_CONSUMPTION_VERIFIER_ADDRESS;
        const message: PurchaseProofMessage = {
            cafeId: proof.cafeId,
            user: consumerAccount.address,
            productId: proof.productId,
            amountCentimos: BigInt(proof.amountCentimos),
            receiptHash: proof.receiptHash as `0x${string}`,
            nonce: proof.nonce as `0x${string}`,
            expiry: BigInt(Math.floor(proof.expiresAt.getTime() / 1000)),
            chainId: BigInt(chainConfig.id),
            verifyingContract,
        };
        const typedData = {
            domain: purchaseProofDomain({
                verifyingContract,
                chainId: chainConfig.id,
            }),
            types: PURCHASE_PROOF_TYPES,
            primaryType: "PurchaseProof" as const,
            message,
        };
        const [cafeSignature, consumerSignature] = await Promise.all([
            cafeAccount.signTypedData(typedData),
            consumerAccount.signTypedData(typedData),
        ]);

        // The guarded repository update revalidates issued + unexpired using
        // PostgreSQL's clock, closing confirmation races and TOCTOU gaps.
        await bindProofSignatures(
            proof.id,
            consumerUserId,
            cafeSignature,
            consumerSignature,
        );
        return ok(
            await new PostgresMockConsumerChain().submitConsumption({
                proofId: proof.id,
                idempotencyKey: `emission:${proof.id}`,
            }),
        );
    } catch {
        // If another confirmation won the guarded update, return its
        // idempotent submission rather than turning a duplicate into an error.
        const current = await findProofById(input.proofId);
        if (
            current?.status === "confirmed" &&
            current.consumerUserId === consumerUserId
        ) {
            try {
                return ok(
                    await new PostgresMockConsumerChain().submitConsumption({
                        proofId: current.id,
                        idempotencyKey: `emission:${current.id}`,
                    }),
                );
            } catch {
                // Fall through to the actionable generic error below.
            }
        }
        return err(
            AppErrors.unprocessableEntity({
                targets: ["proofId"],
                cause: "No se pudo confirmar la compra. Inténtalo de nuevo.",
            }),
        );
    }
}
