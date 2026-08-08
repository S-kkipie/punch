import { Elysia } from "elysia";
import { createPurchaseProofRoute } from "./routes/create-purchase-proof.route";
import { getPurchaseProofRoute } from "./routes/get-purchase-proof.route";

export const consumptionRouter = new Elysia({ prefix: "/consumption" })
    .use(createPurchaseProofRoute)
    .use(getPurchaseProofRoute);
