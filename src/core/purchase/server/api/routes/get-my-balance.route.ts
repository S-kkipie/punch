import { Elysia } from "elysia";
import { z } from "zod";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { getConsumerBalance } from "../../services/get-balance-service";

const balanceSchema = z
    .object({
        punchBalance: z.number().int().nonnegative().nullable(),
        stale: z.boolean(),
    })
    .strict();

export const getMyBalanceRoute = new Elysia().use(authed).get(
    "/balance",
    async ({ user, status }) => {
        const result = await getConsumerBalance(user.id);
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
            200: successResponseSchema(balanceSchema, "PunchBalance"),
            401: errorResponseSchema(401),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Purchases"], summary: "Get my PUNCH balance" },
    },
);
