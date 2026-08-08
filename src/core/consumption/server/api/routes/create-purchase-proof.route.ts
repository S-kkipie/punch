import { Elysia, t } from "elysia";
import { createPurchaseProofSchema } from "@/core/consumption/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
} from "@/server/common/responses";
import { createPurchaseProofService } from "../../services/create-purchase-proof-service";

export const createPurchaseProofRoute = new Elysia().use(authed).post(
    "/:cafeId/purchase-proofs",
    async ({ user, params, body, status }) => {
        const result = await createPurchaseProofService(
            user.id,
            params.cafeId,
            body,
        );
        if (!result.ok)
            return status(
                result.error.status as 500,
                errorToResponse(result.error),
            );
        return status(201, CommonResponse.created({ response: result.data }));
    },
    {
        authed: true,
        params: t.Object({ cafeId: t.String() }),
        body: createPurchaseProofSchema,
        response: {
            201: t.Object({
                status: t.Literal(201),
                code: t.Literal("CREATED"),
                response: t.Object({
                    id: t.String(),
                    expiresAt: t.String(),
                    deepLink: t.String(),
                }),
            }),
            400: errorResponseSchema(400),
            401: errorResponseSchema(401),
            403: errorResponseSchema(403),
            404: errorResponseSchema(404),
            422: errorResponseSchema(422),
            500: errorResponseSchema(500),
        },
        detail: {
            tags: ["Consumption"],
            summary: "Generar un comprobante de compra",
        },
    },
);
