import { Elysia } from "elysia";
import { confirmPurchaseRoute } from "./routes/confirm-purchase.route";
import { createPurchaseProofRoute } from "./routes/create-purchase-proof.route";
import { getPurchaseProofRoute } from "./routes/get-purchase-proof.route";
import { getTransactionRoute } from "./routes/get-transaction.route";

export const consumptionRouter = new Elysia({ prefix: "/consumption" })
    .use(createPurchaseProofRoute)
    .use(getPurchaseProofRoute)
    .use(confirmPurchaseRoute)
    .use(getTransactionRoute);
