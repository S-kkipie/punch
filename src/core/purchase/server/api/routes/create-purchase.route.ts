import { Elysia } from "elysia";
import {
    createPurchaseSchema,
    purchaseOrderSchema,
} from "@/core/purchase/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    createdResponseSchema,
    errorResponseSchema,
    errorToResponse,
} from "@/server/common/responses";
import { createPurchaseService } from "../../services/create-purchase-service";

export const createPurchaseRoute = new Elysia().use(authed).post(
    "/",
    async ({ user, body, status }) => {
        const result = await createPurchaseService(user.id, body);
        if (!result.ok)
            return status(
                result.error.status as 500,
                errorToResponse(result.error),
            );
        return status(201, CommonResponse.created({ response: result.data }));
    },
    {
        authed: true,
        body: createPurchaseSchema,
        response: {
            201: createdResponseSchema(purchaseOrderSchema, "PurchaseOrder"),
            400: errorResponseSchema(400),
            401: errorResponseSchema(401),
            404: errorResponseSchema(404),
            422: errorResponseSchema(422),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Purchases"], summary: "Create a purchase order" },
    },
);
