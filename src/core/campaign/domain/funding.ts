import { canPublish, lifecycleOf, requiredBudget } from "./transitions";
import type { CampaignLifecycle, ProjectionCampaignSnapshot } from "./types";

export type CampaignFunding = {
    required: bigint;
    funded: bigint;
    missing: bigint;
    lifecycle: CampaignLifecycle;
    canPublish: boolean;
};

export function calculateCampaignFunding(
    campaign: {
        voucherPayout: bigint;
        maxVouchers: number;
        chainCampaignId: number | null;
    },
    projection: ProjectionCampaignSnapshot | null,
): CampaignFunding {
    const required = requiredBudget(campaign);
    const funded = projection?.budget ?? 0n;
    return {
        required,
        funded,
        missing: funded >= required ? 0n : required - funded,
        lifecycle: lifecycleOf(campaign, projection),
        canPublish: canPublish(projection, required),
    };
}
