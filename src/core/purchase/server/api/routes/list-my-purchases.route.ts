import { Elysia } from "elysia";
import { purchaseOrderSchema } from "@/core/purchase/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { listMyPurchasesService } from "../../services/list-purchases-service";

export const listMyPurchasesRoute = new Elysia().use(authed).get(
    "/mine",
    async ({ user, status }) => {
        const result = await listMyPurchasesService(user.id);
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
        response: {
            200: successResponseSchema(
                purchaseOrderSchema.array(),
                "PurchaseOrders",
            ),
            401: errorResponseSchema(401),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Purchases"], summary: "List my purchases" },
    },
);
