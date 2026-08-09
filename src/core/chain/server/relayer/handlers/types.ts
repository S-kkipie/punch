import type { Address, Hex, PublicClient, TransactionReceipt } from "viem";
import type { AddressMap } from "@/core/chain/addresses";
import type {
    JobSideEffect,
    RelayerJobKind,
} from "@/core/chain/server/relayer/job-repository";
import type { RelayerJobRow } from "@/server/drizzle/schemas/purchase-schema";
import type { RevertCode } from "../parse-revert";

export type JobSigner =
    | { kind: "relayer" }
    | { kind: "ops" }
    | { kind: "wallet"; walletIndex: number };

export type JobCall = {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
};

export type JobFailure = { code: RevertCode; message: string };

export type JobContext = {
    addresses: AddressMap;
    pub: Pick<PublicClient, "readContract" | "simulateContract" | "getLogs">;
    now: () => Date;
};

export type JobHandler = {
    kind: RelayerJobKind;
    signer(job: RelayerJobRow): JobSigner;
    call(job: RelayerJobRow, ctx: JobContext): Promise<JobCall>;
    preflight?(job: RelayerJobRow, ctx: JobContext): Promise<JobFailure | null>;
    /** Reverts meaning the chain already holds the desired state. */
    idempotentCodes?: ReadonlySet<RevertCode>;
    onSubmitted?(job: RelayerJobRow, txHash: Hex): JobSideEffect | undefined;
    onConfirmed?(
        job: RelayerJobRow,
        receipt: TransactionReceipt,
    ): JobSideEffect | undefined;
    onFailed?(
        job: RelayerJobRow,
        failure: JobFailure,
    ): JobSideEffect | undefined;
    onRetry?(job: RelayerJobRow): JobSideEffect | undefined;
    onPending?(job: RelayerJobRow): JobSideEffect | undefined;
};
