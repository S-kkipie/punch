import { Elysia } from "elysia";
import { confirmPurchaseRoute } from "./routes/confirm-purchase.route";
import { createPurchaseProofRoute } from "./routes/create-purchase-proof.route";
import { getPurchaseProofRoute } from "./routes/get-purchase-proof.route";
import { getTransactionRoute } from "./routes/get-transaction.route";
import { requestPunchRedemptionRoute } from "./routes/request-punch-redemption.route";
import { decidePunchRedemptionRoute } from "./routes/decide-punch-redemption.route";
import { listCafeRedemptionInboxRoute } from "./routes/list-cafe-redemption-inbox.route";

export const consumptionRouter = new Elysia({ prefix: "/consumption" })
    .use(createPurchaseProofRoute)
    .use(getPurchaseProofRoute)
    .use(confirmPurchaseRoute)
    .use(getTransactionRoute)
    .use(requestPunchRedemptionRoute)
    .use(decidePunchRedemptionRoute)
    .use(listCafeRedemptionInboxRoute);
