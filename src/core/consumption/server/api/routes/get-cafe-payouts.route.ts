import { Elysia, t } from "elysia";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
} from "@/server/common/responses";
import { getCafePayoutsService } from "../../services/get-cafe-payouts-service";

export const getCafePayoutsRoute = new Elysia().use(authed).get(
    "/:cafeId/payouts",
    async ({ user, params, status }) => {
        const result = await getCafePayoutsService(user.id, params.cafeId);
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
        params: t.Object({ cafeId: t.String() }),
        response: {
            200: t.Object({
                status: t.Literal(200),
                code: t.Literal("OK"),
                response: t.Object({
                    totalCentimos: t.Number(),
                    redemptionCount: t.Number(),
                    ownerMpenCentimos: t.Nullable(t.Number()),
                }),
            }),
            401: errorResponseSchema(401),
            403: errorResponseSchema(403),
            500: errorResponseSchema(500),
        },
        detail: {
            tags: ["Consumption"],
            summary: "Consultar pagos de canjes de un café",
        },
    },
);
