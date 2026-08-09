import { describe, expect, it, vi } from "vitest";
import { isAuthorizedCafeOperator } from "../cafe-authorization";

describe("isAuthorizedCafeOperator", () => {
    it("reads CafeRegistry authorization for the configured cafe and wallet", async () => {
        const readContract = vi.fn().mockResolvedValue(true);
        const result = await isAuthorizedCafeOperator(
            {
                chainCafeId: 7,
                walletAddress: "0x0000000000000000000000000000000000000007",
            },
            { publicClient: { readContract } },
        );

        expect(result).toBe(true);
        expect(readContract).toHaveBeenCalledWith({
            address: expect.any(String),
            abi: expect.any(Array),
            functionName: "isAuthorized",
            args: [7n, "0x0000000000000000000000000000000000000007"],
        });
    });
});
