export const DEMO_APPLICANT_EMAIL = "quinto@punch.pe";
export const DEMO_CAMPAIGN_NAME = "Bienvenida a Esquina Sur";
export const DEMO_CRAWL_NAME = "Ruta Miraflores–Barranco–Surquillo";
const DAY = 86_400_000;

export function demoCampaignValues(now: number, cafeId: string) {
    return {
        kind: "verified_acquisition" as const,
        cafeId,
        name: DEMO_CAMPAIGN_NAME,
        windowStart: new Date(now - 7 * DAY),
        windowEnd: new Date(now + 30 * DAY),
        active: true,
    };
}

export function canonicalDemoCrawlId(
    rows: Array<{ id: string; name: string }>,
): string | undefined {
    return rows.find((row) => row.name === DEMO_CRAWL_NAME)?.id;
}

export function demoCrawlValues(now: number) {
    return {
        name: DEMO_CRAWL_NAME,
        expiresAt: new Date(now + 60 * DAY),
        active: true,
    };
}

export function demoCrawlSteps(
    crawlId: string,
    cafeIds: [string, string, string],
) {
    return cafeIds.map((cafeId, stepIndex) => ({ crawlId, stepIndex, cafeId }));
}
