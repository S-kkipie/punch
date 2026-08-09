import { describe, expect, it, vi } from "vitest";
import type { JobHandler } from "../handlers/types";
import type { RelayerDeps } from "../relayer";
import { recoverStuckJobs, runRelayerOnce } from "../relayer";

const handler: JobHandler = {
    kind: "campaign_create",
    idempotentOnChain: false,
    signer: () => ({ kind: "relayer" }),
    call: async () => ({
        address: `0x${"11".repeat(20)}` as `0x${string}`,
        abi: [],
        functionName: "createCampaign",
        args: [],
    }),
};

vi.mock("../handlers/registry", () => ({ handlerFor: () => handler }));

type JobFixture = {
    id: string;
    kind: "campaign_create";
    orderId: null;
    payload: Record<string, never>;
    attempts: number;
    nextRetryAt: Date;
    status: "pending" | "submitted";
    txHash: string | null;
    signedTx: string | null;
    lastError: string | null;
    createdAt: Date;
    updatedAt: Date;
};

function job(overrides: Partial<JobFixture> = {}): JobFixture {
    return {
        id: "job",
        kind: "campaign_create",
        orderId: null,
        payload: {},
        attempts: 0,
        nextRetryAt: new Date(),
        status: "pending",
        txHash: null,
        signedTx: null,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    };
}

function deps(overrides: Partial<RelayerDeps> = {}) {
    const current = job();
    const signed = "0xdeadbeef" as `0x${string}`;
    const d = {
        findJobsToRun: vi.fn().mockResolvedValue([current]),
        claimSubmittedJobs: vi.fn().mockResolvedValue([]),
        markJobSigned: vi.fn().mockImplementation(async (_id, txHash, tx) => {
            current.txHash = txHash;
            current.signedTx = tx;
        }),
        markJobSubmitted: vi.fn().mockImplementation(async () => {
            current.status = "submitted";
        }),
        markJobConfirmed: vi.fn(),
        markJobRetry: vi.fn(),
        markJobFailed: vi.fn(),
        markJobPending: vi.fn().mockImplementation(async () => {
            current.status = "pending";
        }),
        wallet: {
            prepareTransactionRequest: vi.fn().mockResolvedValue({}),
            signTransaction: vi.fn().mockResolvedValue(signed),
            sendRawTransaction: vi.fn(),
            writeContract: vi.fn(),
        },
        pub: {
            waitForTransactionReceipt: vi
                .fn()
                .mockResolvedValue({ status: "success" }),
            getTransactionReceipt: vi.fn(),
            getLogs: vi.fn(),
            simulateContract: vi.fn(),
        },
        addresses: {},
        submitter: `0x${"22".repeat(20)}`,
        now: () => new Date("2026-01-01T00:00:00Z"),
        ...overrides,
    } as unknown as RelayerDeps;
    return { d, current };
}

describe("non-idempotent relayer sends", () => {
    it("reuses persisted bytes after broadcast failure", async () => {
        const { d, current } = deps();
        const send = d.wallet.sendRawTransaction as ReturnType<typeof vi.fn>;
        send.mockRejectedValueOnce(
            new Error("connection reset"),
        ).mockResolvedValue("0xhash");

        await runRelayerOnce(d);
        d.findJobsToRun = vi.fn().mockResolvedValue([current]);
        await runRelayerOnce(d);

        expect(d.wallet.signTransaction).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledTimes(2);
        expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
    });

    it("does not sign again after missing receipt requeues the job", async () => {
        const { d, current } = deps();
        const send = d.wallet.sendRawTransaction as ReturnType<typeof vi.fn>;
        send.mockResolvedValue("0xhash");
        await runRelayerOnce(d);

        d.claimSubmittedJobs = vi.fn().mockResolvedValue([current]);
        d.pub.getTransactionReceipt = vi.fn().mockRejectedValue(
            Object.assign(new Error("receipt not found"), {
                name: "TransactionReceiptNotFoundError",
            }),
        );
        await recoverStuckJobs(d);

        expect(d.markJobPending).toHaveBeenCalledWith("job", expect.any(Date));
        expect(current.status).toBe("pending");
        expect(current.signedTx).toBe("0xdeadbeef");
        expect(current.txHash).toBeTruthy();

        await runRelayerOnce(d);

        expect(d.wallet.signTransaction).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledTimes(2);
    });

    it("classifies nonce-too-low rebroadcasts as superseded", async () => {
        const { d, current } = deps();
        current.signedTx = "0xdeadbeef";
        current.txHash = "0xhash";
        d.findJobsToRun = vi.fn().mockResolvedValue([current]);
        (
            d.wallet.sendRawTransaction as ReturnType<typeof vi.fn>
        ).mockRejectedValue(new Error("nonce too low"));

        await runRelayerOnce(d);

        expect(d.wallet.signTransaction).not.toHaveBeenCalled();
        expect(d.markJobFailed).toHaveBeenCalledWith(
            "job",
            "superseded",
            "superseded",
        );
    });
});
