import { Elysia, t } from "elysia";
import { authed } from "@/server/auth/middleware/authed";
import {
    AppErrors,
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
} from "@/server/common/responses";
import { ConsumerChainError } from "../../chain-port";
import { PostgresMockConsumerChain } from "../../postgres-mock-chain";

export const getTransactionRoute = new Elysia().use(authed).get(
    "/transactions/:transactionId",
    async ({ params, status }) => {
        try {
            const result =
                await new PostgresMockConsumerChain().getTransactionStatus(
                    params.transactionId,
                );
            return status(200, CommonResponse.successful({ response: result }));
        } catch (cause) {
            if (cause instanceof ConsumerChainError) {
                return status(
                    404,
                    errorToResponse(
                        AppErrors.notFound({ targets: ["transactionId"] }),
                    ),
                );
            }
            throw cause;
        }
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
        },
        detail: {
            tags: ["Consumption"],
            summary: "Consultar estado de una transacción",
        },
    },
);
