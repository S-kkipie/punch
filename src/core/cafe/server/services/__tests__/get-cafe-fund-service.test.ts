import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repository/find-cafe-by-id", () => ({ findCafeById: vi.fn() }));
vi.mock(
    "@/server/auth/membership/require-cafe-role",
    async (importOriginal) => {
        const actual =
            await importOriginal<
                typeof import("@/server/auth/membership/require-cafe-role")
            >();
        return { ...actual, requireCafeRole: vi.fn() };
    },
);

import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import { AppErrors, err, ok } from "@/server/common/responses";
import { findCafeById } from "../../repository/find-cafe-by-id";
import { getCafeFundService } from "../get-cafe-fund-service";

const membership = {
    id: "membership-1",
    userId: "user-1",
    cafeId: "cafe-1",
    role: "owner" as const,
    createdAt: new Date("2026-01-01"),
};

const cafe = {
    id: "cafe-1",
    name: "Brújula",
    slug: "brujula",
    description: null,
    address: null,
    district: null,
    lat: null,
    lng: null,
    photoUrl: null,
    ruc: null,
    contactPhone: null,
    chainCafeId: 7,
    onboardingStatus: "approved" as const,
    reviewNote: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
};

const epochState = (overrides: Record<string, unknown> = {}) => ({
    originPool: 4_000_000n,
    originPaid: 0n,
    acquisitionPool: 3_000_000n,
    crawlPool: 2_000_000n,
    contingencyPool: 1_000_000n,
    totalReferrals: 4n,
    finalized: false,
    originReleased: false,
    ...overrides,
});

function readerReturning(options: {
    referrals?: bigint;
    epoch?: ReturnType<typeof epochState>;
    pending?: bigint;
}) {
    return {
        readContract: vi.fn(
            async ({ functionName }: { functionName: string }) => {
                if (functionName === "referrals")
                    return options.referrals ?? 2n;
                if (functionName === "getEpoch")
                    return options.epoch ?? epochState();
                if (functionName === "pendingOriginCredit")
                    return options.pending ?? 0n;
                throw new Error(`Unexpected read ${functionName}`);
            },
        ),
    };
}

describe("getCafeFundService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(requireCafeRole).mockResolvedValue(ok(membership));
        vi.mocked(findCafeById).mockResolvedValue(cafe);
    });

    it("estimates origin credit for an unfinalized epoch", async () => {
        const reader = readerReturning({});
        const result = await getCafeFundService("user-1", "cafe-1", {
            reader,
        });

        expect(result).toMatchObject({
            ok: true,
            data: {
                referrals: 2,
                pendingCreditMpen: 2_000_000n,
                estimated: true,
                buckets: {
                    origin: 4_000_000n,
                    acquisition: 3_000_000n,
                    crawl: 2_000_000n,
                    contingency: 1_000_000n,
                },
            },
        });
        expect(reader.readContract).not.toHaveBeenCalledWith(
            expect.objectContaining({ functionName: "pendingOriginCredit" }),
        );
    });

    it("uses pending origin credit for a finalized epoch", async () => {
        const reader = readerReturning({
            epoch: epochState({ finalized: true }),
            pending: 1_750_000n,
        });
        const result = await getCafeFundService("user-1", "cafe-1", {
            reader,
        });

        expect(result).toMatchObject({
            ok: true,
            data: { pendingCreditMpen: 1_750_000n, estimated: false },
        });
        expect(reader.readContract).toHaveBeenCalledWith(
            expect.objectContaining({
                functionName: "pendingOriginCredit",
                args: [expect.any(BigInt), 7n],
            }),
        );
    });

    it("estimates zero when the epoch has no referrals", async () => {
        const result = await getCafeFundService("user-1", "cafe-1", {
            reader: readerReturning({
                referrals: 0n,
                epoch: epochState({ totalReferrals: 0n }),
            }),
        });

        expect(result).toMatchObject({
            ok: true,
            data: { pendingCreditMpen: 0n, estimated: true },
        });
    });

    it("returns conflict when the café has no chain id", async () => {
        vi.mocked(findCafeById).mockResolvedValue({
            ...cafe,
            chainCafeId: null,
        });

        const result = await getCafeFundService("user-1", "cafe-1", {
            reader: readerReturning({}),
        });

        expect(result).toEqual(
            err(AppErrors.conflict({ targets: ["chainCafeId"] })),
        );
    });

    it("propagates owner authorization failures", async () => {
        vi.mocked(requireCafeRole).mockResolvedValue(
            err(AppErrors.forbidden()),
        );

        const result = await getCafeFundService("user-2", "cafe-1", {
            reader: readerReturning({}),
        });

        expect(result).toEqual(err(AppErrors.forbidden()));
        expect(requireCafeRole).toHaveBeenCalledWith("user-2", "cafe-1", [
            "owner",
        ]);
        expect(findCafeById).not.toHaveBeenCalled();
    });
});
