import { Elysia, t } from "elysia";
import { authed } from "@/server/auth/middleware/authed";
import {
    AppErrors,
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
} from "@/server/common/responses";
import { findProofById } from "../../repository/proofs";

export const getPurchaseProofRoute = new Elysia().use(authed).get(
    "/purchase-proofs/:proofId",
    async ({ params, status }) => {
        const row = await findProofById(params.proofId);
        if (!row) return status(404, errorToResponse(AppErrors.notFound()));
        return status(
            200,
            CommonResponse.successful({
                response: {
                    id: row.id,
                    cafeId: row.cafeId,
                    productId: row.productId,
                    amountCentimos: row.amountCentimos,
                    expiresAt: row.expiresAt.toISOString(),
                    status: row.status,
                    createdAt: row.createdAt.toISOString(),
                },
            }),
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
                    createdAt: t.String(),
                }),
            }),
            401: errorResponseSchema(401),
            404: errorResponseSchema(404),
        },
        detail: {
            tags: ["Consumption"],
            summary: "Consultar un comprobante de compra",
        },
    },
);
