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
import { getPurchaseService } from "../../services/get-purchase-service";

export const getPurchaseRoute = new Elysia().use(authed).get(
    "/:id",
    async ({ user, params, status }) => {
        const result = await getPurchaseService(user.id, params.id);
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
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Purchases"], summary: "Get a purchase order" },
    },
);
