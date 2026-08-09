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
                    order: t.Object({
                        id: t.String(),
                        cafeId: t.String(),
                        productId: t.String(),
                        amountSoles: t.Number(),
                        status: t.Union([
                            t.Literal("user_confirmed"),
                            t.Literal("cafe_confirmed"),
                            t.Literal("queued"),
                            t.Literal("submitted"),
                            t.Literal("confirmed"),
                            t.Literal("failed"),
                            t.Literal("expired"),
                        ]),
                        failureReason: t.Union([t.String(), t.Null()]),
                        txHash: t.Union([t.String(), t.Null()]),
                        expiry: t.String(),
                        createdAt: t.String(),
                    }),
                    quote: t.Object({
                        id: t.String(),
                        cafeId: t.String(),
                        productId: t.String(),
                        amountCentimos: t.Number(),
                        expiresAt: t.String(),
                        status: t.Union([
                            t.Literal("issued"),
                            t.Literal("submitted"),
                            t.Literal("confirmed"),
                            t.Literal("failed"),
                            t.Literal("expired"),
                        ]),
                        maskedYapeRef: t.String(),
                        purchaseOrderId: t.Union([t.String(), t.Null()]),
                        failureReason: t.Union([t.String(), t.Null()]),
                        createdAt: t.String(),
                    }),
                    outcome: t.Union([
                        t.Literal("created"),
                        t.Literal("existing"),
                    ]),
                }),
            }),
            400: errorResponseSchema(400),
            401: errorResponseSchema(401),
            403: errorResponseSchema(403),
            404: errorResponseSchema(404),
            409: errorResponseSchema(409),
            422: errorResponseSchema(422),
            500: errorResponseSchema(500),
        },
        detail: {
            tags: ["Consumption"],
            summary: "Confirmar una compra",
        },
    },
);
