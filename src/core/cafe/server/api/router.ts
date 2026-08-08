import { Elysia } from "elysia";
import { createCafeRoute } from "./routes/create-cafe.route";
import { createProductRoute } from "./routes/create-product.route";
import { getCafeRoute } from "./routes/get-cafe.route";
import { listCafesRoute } from "./routes/list-cafes.route";
import { listPendingProductsRoute } from "./routes/list-pending-products.route";
import { listProductsRoute } from "./routes/list-products.route";
import { listReviewQueueRoute } from "./routes/list-review-queue.route";
import { reviewCafeRoute } from "./routes/review-cafe.route";
import { reviewProductRoute } from "./routes/review-product.route";
import { submitCafeRoute } from "./routes/submit-cafe.route";
import { updateCafeRoute } from "./routes/update-cafe.route";
import { updateProductRoute } from "./routes/update-product.route";

export const cafeRouter = new Elysia({ prefix: "/cafes" })
    .use(createCafeRoute)
    .use(listCafesRoute)
    .use(listReviewQueueRoute)
    .use(getCafeRoute)
    .use(updateCafeRoute)
    .use(submitCafeRoute)
    .use(reviewCafeRoute)
    .use(createProductRoute)
    .use(listProductsRoute)
    .use(listPendingProductsRoute)
    .use(updateProductRoute)
    .use(reviewProductRoute);
