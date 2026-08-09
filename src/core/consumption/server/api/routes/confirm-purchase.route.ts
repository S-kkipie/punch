import { Elysia, t } from "elysia";
import { confirmPurchaseSchema } from "@/core/consumption/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
} from "@/server/common/responses";
import { confirmPurchaseService } from "../../services/confirm-purchase-service";

export const confirmPurchaseRoute = new Elysia().use(authed).post(
    "/purchases/confirm",
    async ({ user, body, status }) => {
        const result = await confirmPurchaseService(user.id, body);
        if (!result.ok) {
            return status(
                result.error.status as 500,
                errorToResponse(result.error),
            );
        }
        return status(
            200,
            CommonResponse.successful({ response: result.data }),
        );
    },
    {
        authed: true,
        body: confirmPurchaseSchema,
        response: {
            200: t.Object({
                status: t.Literal(200),
                code: t.Literal("OK"),
                response: t.Object({
                    transactionId: t.String(),
                    status: t.String(),
                }),
            }),
            400: errorResponseSchema(400),
            401: errorResponseSchema(401),
            404: errorResponseSchema(404),
            422: errorResponseSchema(422),
            500: errorResponseSchema(500),
        },
        detail: {
            tags: ["Consumption"],
            summary: "Confirmar una compra",
        },
    },
);
