import { describe, expect, it, vi } from "vitest";
import { getBalanceService } from "../get-balance-service";

function deps(overrides: Record<string, unknown> = {}) {
    return {
        findUserWallet: vi.fn().mockResolvedValue({
            walletIndex: 1,
            walletAddress: "0xAbC0000000000000000000000000000000000123",
        }),
        findBalance: vi.fn().mockResolvedValue({ balance: 42n }),
        isStale: vi.fn().mockResolvedValue(false),
        ...overrides,
    };
}

describe("getBalanceService", () => {
    it("returns the projected balance when fresh", async () => {
        const d = deps();
        await expect(getBalanceService("user-1", d)).resolves.toMatchObject({
            ok: true,
            data: { punchBalance: 42, stale: false },
        });
        expect(d.findBalance).toHaveBeenCalledWith(
            "0xabc0000000000000000000000000000000000123",
        );
    });

    it("marks a paused projection stale", async () => {
        const result = await getBalanceService(
            "user-1",
            deps({ isStale: vi.fn().mockResolvedValue(true) }),
        );
        expect(result).toMatchObject({
            ok: true,
            data: { punchBalance: 42, stale: true },
        });
    });

    it.each([
        ["missing user", null],
        ["missing wallet", { walletIndex: null, walletAddress: null }],
    ])("returns zero for %s", async (_label, wallet) => {
        const d = deps({ findUserWallet: vi.fn().mockResolvedValue(wallet) });
        const result = await getBalanceService("user-1", d);
        expect(result).toMatchObject({
            ok: true,
            data: { punchBalance: 0, stale: false },
        });
        expect(d.findBalance).not.toHaveBeenCalled();
        expect(d.isStale).toHaveBeenCalled();
    });

    it("returns zero and stale when the user has no wallet and the chain projection status is missing", async () => {
        const d = deps({
            findUserWallet: vi.fn().mockResolvedValue(null),
            isStale: vi.fn().mockResolvedValue(true),
        });
        const result = await getBalanceService("user-1", d);
        expect(result).toMatchObject({
            ok: true,
            data: { punchBalance: 0, stale: true },
        });
        expect(d.findBalance).not.toHaveBeenCalled();
    });

    it("returns zero when the projection row is missing", async () => {
        const result = await getBalanceService(
            "user-1",
            deps({ findBalance: vi.fn().mockResolvedValue(null) }),
        );
        expect(result).toMatchObject({
            ok: true,
            data: { punchBalance: 0, stale: false },
        });
    });

    it.each([
        [-1n],
        [BigInt(Number.MAX_SAFE_INTEGER) + 1n],
    ])("rejects corrupt or unsafe balance %s", async (balance) => {
        const result = await getBalanceService(
            "user-1",
            deps({ findBalance: vi.fn().mockResolvedValue({ balance }) }),
        );
        expect(result).toMatchObject({ ok: false, error: { status: 500 } });
    });
});
