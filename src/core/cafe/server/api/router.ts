import { Elysia } from "elysia";
import { createCafeRoute } from "./routes/create-cafe.route";
import { getCafeRoute } from "./routes/get-cafe.route";
import { listCafesRoute } from "./routes/list-cafes.route";
import { listReviewQueueRoute } from "./routes/list-review-queue.route";
import { reviewCafeRoute } from "./routes/review-cafe.route";
import { submitCafeRoute } from "./routes/submit-cafe.route";
import { updateCafeRoute } from "./routes/update-cafe.route";

export const cafeRouter = new Elysia({ prefix: "/cafes" })
    .use(createCafeRoute)
    .use(listCafesRoute)
    .use(listReviewQueueRoute)
    .use(getCafeRoute)
    .use(updateCafeRoute)
    .use(submitCafeRoute)
    .use(reviewCafeRoute);
