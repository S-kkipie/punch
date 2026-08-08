import { Elysia, t } from "elysia";
import { coffeeCrawlSchema } from "@/core/punch/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { getCrawlService } from "../../services/list-crawls-service";

export const getCrawlRoute = new Elysia().use(authed).get(
    "/crawls/:id",
    async ({ params, status }) => {
        const result = await getCrawlService(params.id);
        if (!result.ok)
            return status(
                result.error.status as 404,
                errorToResponse(result.error),
            );
        return status(
            200,
            CommonResponse.successful({ response: result.data }),
        );
    },
    {
        authed: true,
        params: t.Object({ id: t.String() }),
        response: {
            200: successResponseSchema(coffeeCrawlSchema, "Crawl"),
            401: errorResponseSchema(401),
            404: errorResponseSchema(404),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Punch"], summary: "Consultar ruta de café" },
    },
);
