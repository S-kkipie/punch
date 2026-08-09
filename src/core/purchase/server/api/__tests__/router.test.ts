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
vi.mock("../../services/create-purchase-service", () => ({
    createPurchaseService: vi.fn(),
}));
vi.mock("../../services/confirm-purchase-service", () => ({
    confirmPurchaseService: vi.fn(),
}));
vi.mock("../../services/get-purchase-service", () => ({
    getPurchaseService: vi.fn(),
}));
vi.mock("../../services/get-balance-service", () => ({
    getConsumerBalance: vi.fn(),
}));
vi.mock("../../services/list-purchases-service", () => ({
    listMyPurchasesService: vi.fn(),
    listCafePurchasesService: vi.fn(),
}));

import { auth } from "@/server/auth/auth";
import { err, ok } from "@/server/common/responses";
import app from "@/server/router";
import { confirmPurchaseService } from "../../services/confirm-purchase-service";
import { createPurchaseService } from "../../services/create-purchase-service";
import { getConsumerBalance } from "../../services/get-balance-service";
import { getPurchaseService } from "../../services/get-purchase-service";
import {
    listCafePurchasesService,
    listMyPurchasesService,
} from "../../services/list-purchases-service";

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
const validBody = {
    cafeId: "cafe-1",
    productId: "product-1",
    amountSoles: 10,
    yapeRef: "YAPE-1234",
};

async function request(path: string, init?: RequestInit) {
    return app.handle(new Request(`http://localhost${path}`, init));
}
const authedRequest = (path: string, init?: RequestInit) => {
    vi.mocked(auth.api.getSession).mockResolvedValue(session as never);
    return request(path, init);
};

describe("purchase API routes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(auth.api.getSession).mockResolvedValue(null);
    });

    it("rejects unauthenticated create before invoking service", async () => {
        const response = await request("/api/v1/purchases/", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(validBody),
        });
        expect(response.status).toBe(401);
        expect(createPurchaseService).not.toHaveBeenCalled();
    });

    it("creates an order without exposing private fields", async () => {
        vi.mocked(createPurchaseService).mockResolvedValue(ok(order));
        const response = await authedRequest("/api/v1/purchases/", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(validBody),
        });
        expect(response.status).toBe(201);
        const body = await response.json();
        expect(body.response).toEqual(order);
        expect(JSON.stringify(body)).not.toMatch(
            /yapeRef|receiptHash|nonce|wallet|signature|relayer/i,
        );
    });

    it("allows the café owner to confirm", async () => {
        vi.mocked(confirmPurchaseService).mockResolvedValue(
            ok({ ...order, status: "queued" }),
        );
        const response = await authedRequest(
            "/api/v1/purchases/order-1/confirm",
            {
                method: "POST",
            },
        );
        expect(response.status).toBe(200);
        expect(confirmPurchaseService).toHaveBeenCalledWith(
            "user-1",
            "order-1",
        );
    });

    it("maps non-owner confirmation to 403", async () => {
        vi.mocked(confirmPurchaseService).mockResolvedValue(
            err({ type: "ForbiddenError", code: "FORBIDDEN", status: 403 }),
        );
        const response = await authedRequest(
            "/api/v1/purchases/order-1/confirm",
            {
                method: "POST",
            },
        );
        expect(response.status).toBe(403);
    });

    it("denies cross-user get and allows the order participant", async () => {
        vi.mocked(getPurchaseService).mockResolvedValue(
            err({ type: "ForbiddenError", code: "FORBIDDEN", status: 403 }),
        );
        expect((await authedRequest("/api/v1/purchases/order-1")).status).toBe(
            403,
        );
        vi.mocked(getPurchaseService).mockResolvedValue(ok(order));
        expect((await authedRequest("/api/v1/purchases/order-1")).status).toBe(
            200,
        );
    });

    it("requires auth and routes /balance statically, not /:id", async () => {
        expect((await request("/api/v1/purchases/balance")).status).toBe(401);
        expect(getConsumerBalance).not.toHaveBeenCalled();

        vi.mocked(getConsumerBalance).mockResolvedValue(
            ok({ punchBalance: 42, stale: true }),
        );
        const response = await authedRequest("/api/v1/purchases/balance");
        expect(response.status).toBe(200);
        expect(getConsumerBalance).toHaveBeenCalledWith("user-1");
        expect(getPurchaseService).not.toHaveBeenCalled();
        expect(await response.json()).toEqual({
            response: { punchBalance: 42, stale: true },
            code: "OK",
            status: 200,
        });
        expect(
            JSON.stringify(
                await (await authedRequest("/api/v1/purchases/balance")).json(),
            ),
        ).not.toMatch(/wallet|projection|address|internal/i);
    });

    it("routes /mine to the current-user listing, not /:id", async () => {
        vi.mocked(listMyPurchasesService).mockResolvedValue(ok([order]));
        const response = await authedRequest("/api/v1/purchases/mine");
        expect(response.status).toBe(200);
        expect(listMyPurchasesService).toHaveBeenCalledWith("user-1");
        expect(getPurchaseService).not.toHaveBeenCalled();
    });

    it("allows café members and forwards valid status", async () => {
        vi.mocked(listCafePurchasesService).mockResolvedValue(ok([order]));
        const response = await authedRequest(
            "/api/v1/purchases/cafe/cafe-1?status=user_confirmed",
        );
        expect(response.status).toBe(200);
        expect(listCafePurchasesService).toHaveBeenCalledWith(
            "user-1",
            "cafe-1",
            "user_confirmed",
        );
    });

    it("denies non-members from café listing", async () => {
        vi.mocked(listCafePurchasesService).mockResolvedValue(
            err({ type: "ForbiddenError", code: "FORBIDDEN", status: 403 }),
        );
        expect(
            (await authedRequest("/api/v1/purchases/cafe/cafe-1")).status,
        ).toBe(403);
    });

    it("rejects invalid café status without calling service", async () => {
        const response = await authedRequest(
            "/api/v1/purchases/cafe/cafe-1?status=bogus",
        );
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
            code: "VALIDATION",
            status: 400,
        });
        expect(listCafePurchasesService).not.toHaveBeenCalled();
    });
});
