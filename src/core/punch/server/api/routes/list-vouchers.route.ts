import { Elysia } from "elysia";
import { consumerVoucherSchema } from "@/core/punch/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { listVouchersService } from "../../services/list-vouchers-service";

export const listVouchersRoute = new Elysia().use(authed).get(
    "/vouchers",
    async ({ user, status }) => {
        const result = await listVouchersService(user.id);
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
            200: successResponseSchema(
                consumerVoucherSchema.array(),
                "Vouchers",
            ),
            401: errorResponseSchema(401),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Punch"], summary: "Listar vouchers del consumidor" },
    },
);
