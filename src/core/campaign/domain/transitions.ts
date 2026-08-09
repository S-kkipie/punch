import type { ProjectionCampaignRow } from "@/server/drizzle/schemas/chain-schema";
import type { CampaignLifecycle } from "./types";

export function requiredBudget(params: {
    voucherPayout: bigint;
    maxVouchers: number;
}): bigint {
    return params.voucherPayout * BigInt(params.maxVouchers);
}

export function lifecycleOf(
    link: { chainCampaignId: number | null },
    projection: ProjectionCampaignRow | null,
): CampaignLifecycle {
    if (link.chainCampaignId === null || !projection) return "creating";
    return projection.status;
}

export function canPublish(
    projection: ProjectionCampaignRow | null,
    required: bigint,
): boolean {
    if (!projection) return false;
    if (projection.status !== "draft") return false;
    return projection.budget >= required;
}
