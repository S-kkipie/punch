import type { CampaignLifecycle, ProjectionCampaignSnapshot } from "./types";

export function requiredBudget(params: {
    voucherPayout: bigint;
    maxVouchers: number;
}): bigint {
    return params.voucherPayout * BigInt(params.maxVouchers);
}

export function lifecycleOf(
    link: { chainCampaignId: number | null },
    projection: ProjectionCampaignSnapshot | null,
): CampaignLifecycle {
    if (link.chainCampaignId === null || !projection) return "creating";
    return projection.status;
}

export function canPublish(
    projection: ProjectionCampaignSnapshot | null,
    required: bigint,
): boolean {
    if (!projection) return false;
    if (projection.status !== "draft") return false;
    return projection.budget >= required;
}
