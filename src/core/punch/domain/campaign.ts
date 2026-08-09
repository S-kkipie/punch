export type CampaignEligibilityInput = {
    campaignCafeId: string;
    purchaseCafeId: string;
    hadPriorPaidPurchaseAtCafe: boolean;
    purchaseAt: Date;
    campaignWindowStart: Date;
    campaignWindowEnd: Date;
};

export function isEligibleForAcquisitionCampaign(
    input: CampaignEligibilityInput,
): boolean {
    return (
        input.purchaseCafeId === input.campaignCafeId &&
        !input.hadPriorPaidPurchaseAtCafe &&
        input.purchaseAt >= input.campaignWindowStart &&
        input.purchaseAt <= input.campaignWindowEnd
    );
}
