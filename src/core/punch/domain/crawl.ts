export type CrawlStepDefinition = { stepIndex: number; cafeId: string };

export type CrawlProgressInput = {
    steps: CrawlStepDefinition[];
    completedCafeIds: string[];
    purchaseCafeId: string;
    now: Date;
    crawlExpiresAt: Date;
};

export type CrawlAdvanceResult =
    | {
          advanced: false;
          reason: "expired" | "not_next_step" | "already_completed";
      }
    | { advanced: true; nextStepIndex: number; crawlCompleted: boolean };

/** Ordered A→B→C progression: only the next distinct café's purchase advances the crawl. */
export function advanceCrawl(input: CrawlProgressInput): CrawlAdvanceResult {
    if (input.now > input.crawlExpiresAt)
        return { advanced: false, reason: "expired" };
    if (input.completedCafeIds.length >= input.steps.length) {
        return { advanced: false, reason: "already_completed" };
    }
    const nextStep = input.steps[input.completedCafeIds.length];
    if (!nextStep || nextStep.cafeId !== input.purchaseCafeId) {
        return { advanced: false, reason: "not_next_step" };
    }
    const nextStepIndex = input.completedCafeIds.length + 1;
    return {
        advanced: true,
        nextStepIndex,
        crawlCompleted: nextStepIndex === input.steps.length,
    };
}
