import { Elysia } from "elysia";
import { getCampaignRoute } from "./routes/get-campaign.route";
import { getCrawlRoute } from "./routes/get-crawl.route";
import { getDashboardRoute } from "./routes/get-dashboard.route";
import { listCampaignsRoute } from "./routes/list-campaigns.route";
import { listCrawlsRoute } from "./routes/list-crawls.route";
import { listVouchersRoute } from "./routes/list-vouchers.route";

export const punchRouter = new Elysia({ prefix: "/punch" })
    .use(getDashboardRoute)
    .use(listCampaignsRoute)
    .use(getCampaignRoute)
    .use(listCrawlsRoute)
    .use(getCrawlRoute)
    .use(listVouchersRoute);
