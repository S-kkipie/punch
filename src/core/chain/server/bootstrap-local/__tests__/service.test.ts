import { describe, expect, it, vi } from "vitest";
import {
    type BootstrapChain,
    type BootstrapRepository,
    bootstrapApprovedSeedCafes,
} from "../service";

const address = (n: string) => `0x${n.padStart(40, "0")}` as `0x${string}`;

function fixture() {
    const cafes = [1, 2, 3, 4].map((n) => ({
        id: `cafe-${n}`,
        slug: `cafe-${n}`,
        chainCafeId: null as number | null,
        ownerWalletIndex: n,
        ownerWalletAddress: address(String(n)),
        products: [
            {
                id: `emission-${n}`,
                chainProductId: null as number | null,
                type: "emission" as const,
                approvalStatus: "approved" as const,
                active: true,
            },
            {
                id: `reward-${n}`,
                chainProductId: null,
                type: "reward" as const,
                approvalStatus: "approved" as const,
                active: true,
            },
        ],
    }));
    const repository: BootstrapRepository = {
        listApprovedSeedCafes: vi.fn(async () => cafes),
        persistCafeMappings: vi.fn(async () => undefined),
    };
    const chain: BootstrapChain = {
        ownerAddressForIndex: (index) => address(String(index)),
        countCafes: vi.fn(async () => 0n),
        inspectCafe: vi.fn(async () => null),
        seedCafe: vi.fn(async ({ ownerWalletIndex, eligibleProductIds }) => ({
            chainCafeId: BigInt(ownerWalletIndex),
            ownerAddress: address(String(ownerWalletIndex)),
            eligibleProductIds,
        })),
        verifyCafe: vi.fn(async () => undefined),
    };
    return { cafes, repository, chain };
}

describe("bootstrapApprovedSeedCafes", () => {
    it("seeds four approved cafes and persists eligible mappings after verification", async () => {
        const { repository, chain } = fixture();

        await bootstrapApprovedSeedCafes({ repository, chain });

        expect(chain.seedCafe).toHaveBeenCalledTimes(4);
        expect(chain.seedCafe).toHaveBeenNthCalledWith(1, {
            ownerWalletIndex: 1,
            eligibleProductIds: [1n],
        });
        expect(repository.persistCafeMappings).toHaveBeenCalledTimes(4);
        expect(repository.persistCafeMappings).toHaveBeenNthCalledWith(1, {
            cafeId: "cafe-1",
            chainCafeId: 1,
            products: [{ productId: "emission-1", chainProductId: 1 }],
        });
    });

    it("ignores reward, pending, and inactive products when assigning IDs", async () => {
        const { repository, chain, cafes } = fixture();
        cafes[0].products.push(
            {
                id: "pending-emission",
                chainProductId: null,
                type: "emission",
                approvalStatus: "pending" as "approved",
                active: true,
            },
            {
                id: "inactive-emission",
                chainProductId: null,
                type: "emission",
                approvalStatus: "approved",
                active: false,
            },
        );

        await bootstrapApprovedSeedCafes({ repository, chain });

        expect(chain.seedCafe).toHaveBeenNthCalledWith(1, {
            ownerWalletIndex: 1,
            eligibleProductIds: [1n],
        });
        expect(repository.persistCafeMappings).toHaveBeenCalledWith({
            cafeId: "cafe-1",
            chainCafeId: 1,
            products: [{ productId: "emission-1", chainProductId: 1 }],
        });
        expect(cafes[0].products[1].chainProductId).toBeNull();
        expect(cafes[0].products[2].chainProductId).toBeNull();
    });

    it("rerun verifies existing mappings without duplicate writes", async () => {
        const { repository, chain, cafes } = fixture();
        cafes.forEach((cafe, i) => {
            cafe.chainCafeId = i + 1;
            cafe.products[0].chainProductId = 1;
        });
        vi.mocked(chain.countCafes).mockResolvedValue(4n);
        vi.mocked(chain.inspectCafe).mockImplementation(async (id) => ({
            chainCafeId: id,
            ownerAddress: address(String(id)),
            active: true,
            eligibleProductIds: [1n],
            planActive: true,
            credits: 100n,
        }));

        await bootstrapApprovedSeedCafes({ repository, chain });

        expect(chain.seedCafe).not.toHaveBeenCalled();
        expect(repository.persistCafeMappings).not.toHaveBeenCalled();
    });

    it("backfills missing product mappings for an already-mapped cafe after live verification", async () => {
        const { repository, chain, cafes } = fixture();
        cafes.forEach((cafe, i) => {
            cafe.chainCafeId = i + 1;
            cafe.products[0].chainProductId = 1;
        });
        cafes[0].products[0].chainProductId = null;
        vi.mocked(chain.countCafes).mockResolvedValue(4n);
        vi.mocked(chain.inspectCafe).mockImplementation(async (id) => ({
            chainCafeId: id,
            ownerAddress: address(String(id)),
            active: true,
            eligibleProductIds: [1n],
            planActive: true,
            credits: 100n,
        }));

        await bootstrapApprovedSeedCafes({ repository, chain });

        expect(chain.seedCafe).not.toHaveBeenCalled();
        expect(repository.persistCafeMappings).toHaveBeenCalledTimes(1);
        expect(repository.persistCafeMappings).toHaveBeenCalledWith({
            cafeId: "cafe-1",
            chainCafeId: 1,
            products: [{ productId: "emission-1", chainProductId: 1 }],
        });
    });

    it("recovers a null DB mapping from an owner match on chain", async () => {
        const { repository, chain, cafes } = fixture();
        vi.mocked(chain.countCafes).mockResolvedValue(4n);
        vi.mocked(chain.inspectCafe).mockImplementation(async (id) =>
            id === 2n
                ? {
                      chainCafeId: 2n,
                      ownerAddress: address("2"),
                      active: true,
                      eligibleProductIds: [1n],
                      planActive: true,
                      credits: 100n,
                  }
                : null,
        );

        await bootstrapApprovedSeedCafes({ repository, chain });

        expect(chain.seedCafe).toHaveBeenCalledTimes(3);
        expect(repository.persistCafeMappings).toHaveBeenCalledWith({
            cafeId: cafes[1].id,
            chainCafeId: 2,
            products: [{ productId: "emission-2", chainProductId: 1 }],
        });
    });

    it("does not persist a cafe when chain seeding fails", async () => {
        const { repository, chain } = fixture();
        vi.mocked(chain.seedCafe).mockRejectedValueOnce(
            new Error("register cafe failed with reverted transaction 0xdead"),
        );

        await expect(
            bootstrapApprovedSeedCafes({ repository, chain }),
        ).rejects.toThrow(/reverted transaction 0xdead/);
        expect(repository.persistCafeMappings).not.toHaveBeenCalled();
    });

    it("does not persist a cafe when live verification fails", async () => {
        const { repository, chain } = fixture();
        vi.mocked(chain.verifyCafe).mockRejectedValueOnce(
            new Error("live verification failed"),
        );

        await expect(
            bootstrapApprovedSeedCafes({ repository, chain }),
        ).rejects.toThrow(/live verification failed/);
        expect(repository.persistCafeMappings).not.toHaveBeenCalled();
    });

    it("preserves earlier café mappings when a later café fails", async () => {
        const { repository, chain } = fixture();
        vi.mocked(chain.verifyCafe)
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error("cafe-2 verification failed"));

        await expect(
            bootstrapApprovedSeedCafes({ repository, chain }),
        ).rejects.toThrow(/cafe-2 verification failed/);
        expect(repository.persistCafeMappings).toHaveBeenCalledTimes(1);
        expect(repository.persistCafeMappings).toHaveBeenCalledWith({
            cafeId: "cafe-1",
            chainCafeId: 1,
            products: [{ productId: "emission-1", chainProductId: 1 }],
        });
    });

    it("fails closed on a stale non-null mapping", async () => {
        const { repository, chain, cafes } = fixture();
        cafes[0].chainCafeId = 99;
        vi.mocked(chain.inspectCafe).mockResolvedValue({
            chainCafeId: 99n,
            ownerAddress: address("999"),
            active: true,
            eligibleProductIds: [1n],
            planActive: true,
            credits: 100n,
        });

        await expect(
            bootstrapApprovedSeedCafes({ repository, chain }),
        ).rejects.toThrow(/cafe-1.*owner/i);
        expect(repository.persistCafeMappings).not.toHaveBeenCalled();
    });
});
