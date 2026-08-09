import { Elysia, t } from "elysia";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
} from "@/server/common/responses";
import { listHistoryService } from "../../services/list-history-service";

export const listHistoryRoute = new Elysia().use(authed).get(
    "/history",
    async ({ user, status }) => {
        const result = await listHistoryService(user.id);
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
        response: {
            200: t.Object({
                status: t.Literal(200),
                code: t.Literal("OK"),
                response: t.Array(t.Any()),
            }),
            401: errorResponseSchema(401),
            500: errorResponseSchema(500),
        },
        detail: {
            tags: ["Consumption"],
            summary: "Listar el historial del consumidor",
        },
    },
);
