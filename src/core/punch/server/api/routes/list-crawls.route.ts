import { Elysia } from "elysia";
import { coffeeCrawlSchema } from "@/core/punch/domain/schemas";
import { authed } from "@/server/auth/middleware/authed";
import {
    CommonResponse,
    errorResponseSchema,
    errorToResponse,
    successResponseSchema,
} from "@/server/common/responses";
import { listCrawlsService } from "../../services/list-crawls-service";

export const listCrawlsRoute = new Elysia().use(authed).get(
    "/crawls",
    async ({ status }) => {
        const result = await listCrawlsService();
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
            200: successResponseSchema(coffeeCrawlSchema.array(), "Crawls"),
            401: errorResponseSchema(401),
            500: errorResponseSchema(500),
        },
        detail: { tags: ["Punch"], summary: "Listar rutas de café" },
    },
);
