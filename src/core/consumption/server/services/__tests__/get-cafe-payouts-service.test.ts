import { describe, expect, it, vi } from "vitest";
import { err, ok } from "@/server/common/responses";
import { getCafePayoutsService } from "../get-cafe-payouts-service";

describe("getCafePayoutsService", () => {
    const baseDeps = {
        requireMember: vi.fn().mockResolvedValue(ok({ role: "owner" })),
        findProjection: vi.fn().mockResolvedValue({
            totalCentimos: 720,
            redemptionCount: 2,
        }),
        findOwnerWallet: vi
            .fn()
            .mockResolvedValue("0x0000000000000000000000000000000000000007"),
        readOwnerBalance: vi.fn().mockResolvedValue(25_000n),
    };

    it("returns projected payout and chain-backed owner balance", async () => {
        const result = await getCafePayoutsService("user-1", "cafe-1", {
            ...baseDeps,
        });

        expect(result).toEqual({
            ok: true,
            data: {
                totalCentimos: 720,
                redemptionCount: 2,
                ownerMpenCentimos: 2,
            },
        });
        expect(baseDeps.requireMember).toHaveBeenCalledWith(
            "user-1",
            "cafe-1",
            ["owner", "barista"],
        );
    });

    it("rejects users without café membership", async () => {
        const findProjection = vi.fn();
        const result = await getCafePayoutsService("user-1", "cafe-1", {
            ...baseDeps,
            findProjection,
            requireMember: vi.fn().mockResolvedValue(
                err({
                    type: "ForbiddenError",
                    code: "FORBIDDEN",
                    status: 403,
                    targets: [],
                }),
            ),
        });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.status).toBe(403);
        expect(findProjection).not.toHaveBeenCalled();
    });

    it("keeps the panel usable when the chain read fails", async () => {
        const result = await getCafePayoutsService("user-1", "cafe-1", {
            ...baseDeps,
            readOwnerBalance: vi.fn().mockRejectedValue(new Error("RPC down")),
        });

        expect(result).toEqual({
            ok: true,
            data: {
                totalCentimos: 720,
                redemptionCount: 2,
                ownerMpenCentimos: null,
            },
        });
    });
});
