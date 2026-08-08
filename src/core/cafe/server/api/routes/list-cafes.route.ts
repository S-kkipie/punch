import { Elysia } from "elysia";
import { cafeSchema } from "@/core/cafe/domain/schemas";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { listCafesService } from "../../services/list-cafes-service";

export const listCafesRoute = new Elysia().get(
    "/",
    async ({ status }) => {
        const result = await listCafesService();
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
        response: {
            200: successResponseSchema(cafeSchema.array(), "Cafes"),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Cafes"], summary: "List approved cafes" },
    },
);
