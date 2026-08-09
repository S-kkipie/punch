import { Elysia } from "elysia";
import { confirmPurchaseRoute } from "./routes/confirm-purchase.route";
import { createPurchaseRoute } from "./routes/create-purchase.route";
import { getMyBalanceRoute } from "./routes/get-my-balance.route";
import { getPurchaseRoute } from "./routes/get-purchase.route";
import { listCafePurchasesRoute } from "./routes/list-cafe-purchases.route";
import { listMyPurchasesRoute } from "./routes/list-my-purchases.route";

export const purchaseRouter = new Elysia({ prefix: "/purchases" })
    .use(createPurchaseRoute)
    .use(listMyPurchasesRoute)
    .use(listCafePurchasesRoute)
    .use(confirmPurchaseRoute)
    .use(getMyBalanceRoute)
    .use(getPurchaseRoute);
