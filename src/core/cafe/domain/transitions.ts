import type { CafeAdmin, CafeOnboardingStatus } from "./types";

const ALLOWED: Record<CafeOnboardingStatus, CafeOnboardingStatus[]> = {
    draft: ["submitted"],
    submitted: ["approved", "rejected"],
    approved: [],
    rejected: ["submitted"],
};

export function canTransition(
    from: CafeOnboardingStatus,
    to: CafeOnboardingStatus,
): boolean {
    return ALLOWED[from].includes(to);
}

/** Fields still missing before a café can be submitted (spec 3b). */
export function submissionGaps(
    cafe: CafeAdmin,
    emissionProductCount: number,
): string[] {
    const gaps: string[] = [];
    if (!cafe.name?.trim()) gaps.push("name");
    if (!cafe.address?.trim()) gaps.push("address");
    if (!cafe.district?.trim()) gaps.push("district");
    if (!cafe.contactPhone?.trim()) gaps.push("contactPhone");
    if (emissionProductCount < 1) gaps.push("emissionProduct");
    return gaps;
}
