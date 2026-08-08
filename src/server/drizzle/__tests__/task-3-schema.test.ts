import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
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

    it("guards punch balances without adding a fake crawl balance check", () => {
        expect(
            getTableConfig(punchBalanceProjection).checks.map(
                (check) => check.name,
            ),
        ).toEqual(["punch_balance_projection_balance_nonneg"]);
        expect(getTableConfig(consumerCrawlProgress).checks).toHaveLength(0);
    });

    it("declares transaction and redemption integrity constraints", () => {
        expect(
            getTableConfig(consumerTransaction).checks.map(
                (check) => check.name,
            ),
        ).toEqual(["consumer_transaction_operation_shape"]);
        expect(
            getTableConfig(redemptionRequest).checks.map((check) => check.name),
        ).toEqual(["redemption_request_kind_shape"]);
        expect(
            getTableConfig(redemptionRequest).foreignKeys.map((key) =>
                key.getName(),
            ),
        ).toContain("redemption_request_voucher_id_consumer_voucher_id_fk");
        expect(
            getTableConfig(consumerTransaction).foreignKeys.map((key) =>
                key.getName(),
            ),
        ).toContain(
            "consumer_transaction_redemption_request_id_redemption_request_id_fk",
        );
        expect(
            getTableConfig(consumerTransaction).indexes.map(
                (index) => index.config.name,
            ),
        ).toEqual(
            expect.arrayContaining([
                "consumer_transaction_proof_id_uq",
                "consumer_transaction_redemption_request_id_uq",
            ]),
        );
    });

    it("declares voucher provenance, proof binding, campaign, and crawl constraints", () => {
        expect(
            getTableConfig(consumerVoucher).checks.map((check) => check.name),
        ).toEqual(["consumer_voucher_source_provenance"]);
        expect(
            getTableConfig(consumerVoucher).foreignKeys.map((key) =>
                key.getName(),
            ),
        ).toContain("consumer_voucher_crawl_id_coffee_crawl_id_fk");
        expect(
            getTableConfig(consumptionProof).checks.map((check) => check.name),
        ).toEqual([
            "consumption_proof_amount_positive",
            "consumption_proof_confirmed_binding",
        ]);
        expect(
            getTableConfig(campaign).checks.map((check) => check.name),
        ).toEqual(["campaign_window_order"]);
        expect(
            getTableConfig(coffeeCrawlStep).checks.map((check) => check.name),
        ).toEqual(["coffee_crawl_step_index_nonneg"]);
        expect(
            getTableConfig(coffeeCrawlStep).indexes.map(
                (index) => index.config.name,
            ),
        ).toContain("coffee_crawl_step_crawl_cafe_uq");
    });
});
