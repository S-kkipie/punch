import { Elysia, t } from "elysia";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
} from "@/server/common/responses";
import { getPurchaseQuoteService } from "../../services/get-purchase-quote-service";

export const getPurchaseProofRoute = new Elysia().use(authed).get(
    "/purchase-proofs/:proofId",
    async ({ user, params, status }) => {
        const result = await getPurchaseQuoteService(user.id, params.proofId);
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
        params: t.Object({ proofId: t.String() }),
        response: {
            200: t.Object({
                status: t.Literal(200),
                code: t.Literal("OK"),
                response: t.Object({
                    id: t.String(),
                    cafeId: t.String(),
                    productId: t.String(),
                    amountCentimos: t.Number(),
                    expiresAt: t.String(),
                    status: t.String(),
                    maskedYapeRef: t.String(),
                    purchaseOrderId: t.Union([t.String(), t.Null()]),
                    failureReason: t.Union([t.String(), t.Null()]),
                    createdAt: t.String(),
                }),
            }),
            401: errorResponseSchema(401),
            404: errorResponseSchema(404),
            500: errorResponseSchema(500),
        },
        detail: {
            tags: ["Consumption"],
            summary: "Consultar una cotización de compra",
        },
    },
);
