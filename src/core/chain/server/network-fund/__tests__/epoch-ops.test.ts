import type { Address } from "viem";
import { describe, expect, it, vi } from "vitest";
import type { AddressMap } from "@/core/chain/addresses";
import { closeEpoch, type EpochOpsDeps, fundCurrentEpoch } from "../epoch-ops";

const networkFund = "0x0000000000000000000000000000000000000001" as Address;
const addresses = {
    networkFund,
} as AddressMap;
const hash = `0x${"1".repeat(64)}` as const;

function deps(options: {
    readContract: (request: {
        functionName: string;
        args?: readonly unknown[];
    }) => unknown;
    writeContract?: (request: {
        functionName: string;
        args?: readonly unknown[];
    }) => unknown;
    cafeIds?: number[];
}) {
    const readContract = vi.fn(options.readContract);
    const writeContract = vi.fn(options.writeContract ?? (() => hash));
    const waitForTransactionReceipt = vi
        .fn()
        .mockResolvedValue({ status: "success" });
    const listChainCafeIds = vi.fn().mockResolvedValue(options.cafeIds ?? []);

    return {
        value: {
            pub: { readContract, waitForTransactionReceipt },
            wallet: { writeContract },
            addresses,
            listChainCafeIds,
        } as unknown as EpochOpsDeps,
        readContract,
        writeContract,
        waitForTransactionReceipt,
        listChainCafeIds,
    };
}

describe("fundCurrentEpoch", () => {
    it("does not submit a transaction when the free balance is zero", async () => {
        const fixture = deps({ readContract: () => 0n });

        await expect(fundCurrentEpoch(fixture.value, 202608)).resolves.toEqual({
            epoch: 202608,
            amount: 0n,
        });
        expect(fixture.writeContract).not.toHaveBeenCalled();
        expect(fixture.waitForTransactionReceipt).not.toHaveBeenCalled();
    });

    it("funds the epoch with the complete free balance and waits for mining", async () => {
        const fixture = deps({ readContract: () => 10_000_000n });

        await expect(fundCurrentEpoch(fixture.value, 202608)).resolves.toEqual({
            epoch: 202608,
            amount: 10_000_000n,
        });
        expect(fixture.writeContract).toHaveBeenCalledWith(
            expect.objectContaining({
                address: networkFund,
                functionName: "fundEpoch",
                args: [202608n, 10_000_000n],
            }),
        );
        expect(fixture.waitForTransactionReceipt).toHaveBeenCalledWith({
            hash,
        });
    });
});

describe("closeEpoch", () => {
    it("finalizes an open epoch and claims only unclaimed cafes with referrals", async () => {
        const fixture = deps({
            cafeIds: [1, 2],
            readContract: ({ functionName, args }) => {
                if (functionName === "getEpoch") return { finalized: false };
                if (functionName === "referrals")
                    return args?.[1] === 1n ? 2n : 0n;
                if (functionName === "originClaimed") return false;
                if (functionName === "pendingOriginCredit") return 4_000_000n;
                throw new Error(`Unexpected read ${functionName}`);
            },
        });

        await expect(closeEpoch(fixture.value, 202608)).resolves.toEqual({
            epoch: 202608,
            claims: [{ chainCafeId: 1, referrals: 2, amount: 4_000_000n }],
        });
        expect(fixture.writeContract).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                functionName: "finalizeOriginEpoch",
                args: [202608n],
            }),
        );
        expect(fixture.writeContract).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                functionName: "claimOriginCredit",
                args: [202608n, 1n],
            }),
        );
        expect(fixture.writeContract).toHaveBeenCalledTimes(2);
        expect(fixture.waitForTransactionReceipt).toHaveBeenCalledTimes(2);
    });

    it("skips a reverted claim and continues claiming later cafes", async () => {
        const fixture = deps({
            cafeIds: [1, 3],
            readContract: ({ functionName, args }) => {
                if (functionName === "getEpoch") return { finalized: true };
                if (functionName === "referrals")
                    return args?.[1] === 1n ? 2n : 1n;
                if (functionName === "originClaimed") return false;
                if (functionName === "pendingOriginCredit")
                    return args?.[1] === 1n ? 4_000_000n : 2_000_000n;
                throw new Error(`Unexpected read ${functionName}`);
            },
            writeContract: ({ functionName, args }) => {
                if (functionName === "claimOriginCredit" && args?.[1] === 1n) {
                    throw new Error("OriginAlreadyClaimed");
                }
                return hash;
            },
        });

        await expect(closeEpoch(fixture.value, 202608)).resolves.toEqual({
            epoch: 202608,
            claims: [{ chainCafeId: 3, referrals: 1, amount: 2_000_000n }],
        });
        expect(fixture.writeContract).toHaveBeenCalledTimes(2);
        expect(fixture.waitForTransactionReceipt).toHaveBeenCalledTimes(1);
    });
});
