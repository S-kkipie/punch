import { Elysia, t } from "elysia";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
} from "@/server/common/responses";
import { getTransactionStatusService } from "../../services/get-transaction-status-service";

export const getTransactionRoute = new Elysia().use(authed).get(
    "/transactions/:transactionId",
    async ({ user, params, status }) => {
        const result = await getTransactionStatusService(
            user.id,
            params.transactionId,
        );
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
        params: t.Object({ transactionId: t.String() }),
        response: {
            200: t.Object({
                status: t.Literal(200),
                code: t.Literal("OK"),
                response: t.Object({
                    transactionId: t.String(),
                    status: t.String(),
                    rejectionReason: t.Optional(t.String()),
                }),
            }),
            401: errorResponseSchema(401),
            404: errorResponseSchema(404),
            500: errorResponseSchema(500),
        },
        detail: {
            tags: ["Consumption"],
            summary: "Consultar estado de una transacción",
        },
    },
);
