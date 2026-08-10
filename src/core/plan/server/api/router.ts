import { Elysia } from "elysia";
import { createPlanOrderRoute } from "./routes/create-plan-order.route";
import { getPlanOrderRoute } from "./routes/get-plan-order.route";
import { getPlanStatusRoute } from "./routes/get-plan-status.route";
import { listPlanOrdersRoute } from "./routes/list-plan-orders.route";

export const planRouter = new Elysia({ prefix: "/plans" })
    .use(createPlanOrderRoute)
    .use(listPlanOrdersRoute)
    .use(getPlanStatusRoute)
    .use(getPlanOrderRoute);
