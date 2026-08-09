import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/auth", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/server/auth/auth")>();
    return {
        ...actual,
        auth: {
            ...actual.auth,
            api: { ...actual.auth.api, getSession: vi.fn() },
        },
    };
});
vi.mock("@/core/plan/server/services/create-plan-order-service", () => ({
    createPlanOrderService: vi.fn(),
}));
vi.mock("@/core/plan/server/services/get-plan-status-service", () => ({
    getPlanStatusService: vi.fn(),
    findCafeMembership: vi.fn(),
}));

import { createPlanOrderService } from "@/core/plan/server/services/create-plan-order-service";
import { getPlanStatusService } from "@/core/plan/server/services/get-plan-status-service";
import { auth } from "@/server/auth/auth";
import { planRouter } from "../router";

const session = { user: { id: "user-1" }, session: { id: "session-1" } };

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth.api.getSession).mockResolvedValue(session as never);
});

const order = {
    id: "o1",
    cafeId: "c1",
    kind: "plan",
    priceSoles: 49,
    status: "pending",
    failureReason: null,
    txHash: null,
    createdAt: "2026-08-09T00:00:00.000Z",
};

describe("plan router", () => {
    it("creates an order and answers 201", async () => {
        vi.mocked(createPlanOrderService).mockResolvedValue({
            ok: true,
            data: order,
        } as never);
        const response = await planRouter.handle(
            new Request("http://localhost/plans/orders", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ cafeId: "c1", kind: "plan" }),
            }),
        );
        expect(response.status).toBe(201);
    });

    it("propagates a conflict when a payment is in flight", async () => {
        vi.mocked(createPlanOrderService).mockResolvedValue({
            ok: false,
            error: { type: "ConflictError", code: "CONFLICT", status: 409 },
        } as never);
        const response = await planRouter.handle(
            new Request("http://localhost/plans/orders", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ cafeId: "c1", kind: "plan" }),
            }),
        );
        expect(response.status).toBe(409);
    });

    it("rejects an unknown kind before reaching the service", async () => {
        const response = await planRouter.handle(
            new Request("http://localhost/plans/orders", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ cafeId: "c1", kind: "gift" }),
            }),
        );
        // Elysia's standalone validation response is 422; the mounted app normalizes it to 400.
        expect(response.status).toBe(422);
    });

    it("returns the cafe plan status", async () => {
        vi.mocked(getPlanStatusService).mockResolvedValue({
            ok: true,
            data: {
                cafeId: "c1",
                planActive: true,
                credits: 100,
                unallocatedReserveSoles: 30,
                canPay: true,
                inFlightOrderId: null,
                needsReconciliation: false,
            },
        } as never);
        const response = await planRouter.handle(
            new Request("http://localhost/plans/cafes/c1/status"),
        );
        expect(response.status).toBe(200);
    });
});
