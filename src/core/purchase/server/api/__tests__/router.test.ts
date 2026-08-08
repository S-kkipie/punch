import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/auth", () => ({
    auth: { api: { getSession: vi.fn() } },
}));
vi.mock("../../services/create-purchase-service", () => ({
    createPurchaseService: vi.fn(),
}));
vi.mock("../../services/confirm-purchase-service", () => ({
    confirmPurchaseService: vi.fn(),
}));
vi.mock("../../services/get-purchase-service", () => ({
    getPurchaseService: vi.fn(),
}));
vi.mock("../../services/list-purchases-service", () => ({
    listMyPurchasesService: vi.fn(),
    listCafePurchasesService: vi.fn(),
}));

import { auth } from "@/server/auth/auth";
import { err, ok } from "@/server/common/responses";
import { confirmPurchaseService } from "../../services/confirm-purchase-service";
import { createPurchaseService } from "../../services/create-purchase-service";
import { purchaseRouter } from "../router";

const order = {
    id: "order-1",
    cafeId: "cafe-1",
    productId: "product-1",
    amountSoles: 10,
    status: "user_confirmed" as const,
    failureReason: null,
    txHash: null,
    expiry: "2026-08-08T12:00:00.000Z",
    createdAt: "2026-08-08T11:00:00.000Z",
};

const session = { user: { id: "user-1" }, session: { id: "session-1" } };

async function request(path: string, init?: RequestInit) {
    return purchaseRouter.handle(new Request(`http://localhost${path}`, init));
}

describe("purchase API routes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(auth.api.getSession).mockResolvedValue(null);
    });

    it("rejects unauthenticated create", async () => {
        const response = await request("/purchases/", { method: "POST" });
        expect(response.status).toBe(401);
    });

    it("creates an order for the authenticated user", async () => {
        vi.mocked(auth.api.getSession).mockResolvedValue(session as never);
        vi.mocked(createPurchaseService).mockResolvedValue(ok(order));
        const response = await request("/purchases/", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ cafeId: "cafe-1", productId: "product-1", amountSoles: 10, yapeRef: "YAPE-1234" }),
        });
        expect(response.status).toBe(201);
        expect((await response.json()).response).toEqual(order);
    });

    it("maps non-owner confirmation to 403", async () => {
        vi.mocked(auth.api.getSession).mockResolvedValue(session as never);
        vi.mocked(confirmPurchaseService).mockResolvedValue(err({ type: "ForbiddenError", code: "FORBIDDEN", status: 403 }));
        const response = await request("/purchases/order-1/confirm", { method: "POST" });
        expect(response.status).toBe(403);
    });
});
