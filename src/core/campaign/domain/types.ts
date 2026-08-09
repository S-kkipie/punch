export type CampaignLifecycle =
    | "creating"
    | "draft"
    | "published"
    | "cancelled";

export type CampaignParams = {
    name: string;
    windowStart: Date;
    windowEnd: Date;
    voucherPayout: bigint;
    maxVouchers: number;
};

export type ProjectionCampaignSnapshot = {
    status: "draft" | "published" | "cancelled";
    budget: bigint;
};
