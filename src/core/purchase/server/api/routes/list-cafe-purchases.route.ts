import { Elysia } from "elysia";
import { z } from "zod";
import { purchaseOrderSchema, purchaseOrderStatusSchema } from "@/core/purchase/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import { CommonResponse, errorResponseSchema, errorToResponse, successResponseSchema } from "@/server/common/responses";
import { listCafePurchasesService } from "../../services/list-purchases-service";

const querySchema = z.object({ status: purchaseOrderStatusSchema.optional() });

export const listCafePurchasesRoute = new Elysia().use(authed).get(
    "/cafe/:cafeId",
    async ({ user, params, query, status }) => {
        const result = await listCafePurchasesService(user.id, params.cafeId, query.status);
        if (!result.ok) return status(result.error.status as 500, errorToResponse(result.error));
        return status(200, CommonResponse.successful({ response: result.data }));
    },
    {
        authed: true,
        params: z.object({ cafeId: z.string().min(1) }),
        query: querySchema,
        response: {
            200: successResponseSchema(purchaseOrderSchema.array(), "PurchaseOrders"),
            400: errorResponseSchema(400),
            401: errorResponseSchema(401),
            403: errorResponseSchema(403),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Purchases"], summary: "List cafe purchases" },
    },
);
