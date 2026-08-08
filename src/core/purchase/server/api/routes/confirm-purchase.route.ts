import { Elysia } from "elysia";
import { z } from "zod";
import { purchaseOrderSchema } from "@/core/purchase/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { confirmPurchaseService } from "../../services/confirm-purchase-service";

export const confirmPurchaseRoute = new Elysia().use(authed).post(
    "/:id/confirm",
    async ({ user, params, status }) => {
        const result = await confirmPurchaseService(user.id, params.id);
        if (!result.ok)
            return status(
                result.error.status as 500,
                errorToResponse(result.error),
            );
        return status(
            200,
            CommonResponse.successful({ response: result.data }),
        );
    },
    {
        authed: true,
        params: z.object({ id: z.string().min(1) }),
        response: {
            200: successResponseSchema(purchaseOrderSchema, "PurchaseOrder"),
            401: errorResponseSchema(401),
            403: errorResponseSchema(403),
            404: errorResponseSchema(404),
            409: errorResponseSchema(409),
            422: errorResponseSchema(422),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Purchases"], summary: "Confirm a purchase order" },
    },
);
