import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
    campaign,
    coffeeCrawl,
    coffeeCrawlStep,
    consumerCrawlProgress,
    consumerTransaction,
    consumerVoucher,
    consumptionProof,
    punchBalanceProjection,
    redemptionRequest,
} from "@/server/drizzle/schemas";

describe("consumer domain Drizzle schemas", () => {
    it("exports every consumer and punch table with its database name", () => {
        expect(
            [
                consumptionProof,
                consumerTransaction,
                redemptionRequest,
                punchBalanceProjection,
                campaign,
                consumerVoucher,
                coffeeCrawl,
                coffeeCrawlStep,
                consumerCrawlProgress,
            ].map(getTableName),
        ).toEqual([
            "consumption_proof",
            "consumer_transaction",
            "redemption_request",
            "punch_balance_projection",
            "campaign",
            "consumer_voucher",
            "coffee_crawl",
            "coffee_crawl_step",
            "consumer_crawl_progress",
        ]);
    });
});
