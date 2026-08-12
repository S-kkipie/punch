import { Elysia } from "elysia";
import { cancelCampaignRoute } from "./routes/cancel-campaign.route";
import { createCampaignRoute } from "./routes/create-campaign.route";
import { fundCampaignRoute } from "./routes/fund-campaign.route";
import { listCafeCampaignsRoute } from "./routes/list-cafe-campaigns.route";
import { publishCampaignRoute } from "./routes/publish-campaign.route";

export const campaignRouter = new Elysia({ name: "campaign-router" })
    .use(listCafeCampaignsRoute)
    .use(createCampaignRoute)
    .use(fundCampaignRoute)
    .use(publishCampaignRoute)
    .use(cancelCampaignRoute);
