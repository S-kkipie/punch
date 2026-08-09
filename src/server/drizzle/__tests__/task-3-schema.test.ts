import { readFileSync } from "node:fs";
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

const normalizeSql = (sql: string) =>
    sql.replace(/--.*$/gm, "").replaceAll('"', "").replace(/\s+/g, " ").trim();

const generatedMigration = normalizeSql(
    [
        "0004_flaky_cardiac.sql",
        "0005_exotic_payback.sql",
        "0006_dusty_dormammu.sql",
        "0007_clean_shinobi_shaw.sql",
        "0008_soft_pyro.sql",
        "0010_lucky_dexter_bennett.sql",
    ]
        .map((file) =>
            readFileSync(
                new URL(`../../../../drizzle/${file}`, import.meta.url),
                "utf8",
            ),
        )
        .join("\n"),
);

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
        expect(consumerTransaction.modeledHostPayoutCentimos).toBeDefined();
        expect(
            getTableConfig(consumerTransaction).checks.map(
                (check) => check.name,
            ),
        ).toEqual([
            "consumer_transaction_operation_shape",
            "consumer_transaction_modeled_host_payout_shape",
        ]);
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

    it("preserves the generated bodies of every new check and partial index", () => {
        expect(generatedMigration).toContain(
            "CHECK (consumption_proof.status <> 'confirmed' OR (consumption_proof.consumer_user_id IS NOT NULL AND consumption_proof.cafe_signature IS NOT NULL AND consumption_proof.consumer_signature IS NOT NULL))",
        );
        expect(generatedMigration).toContain(
            "ALTER TABLE consumer_transaction ADD COLUMN modeled_host_payout_centimos integer",
        );
        expect(generatedMigration).toContain(
            "CHECK ((consumer_transaction.operation = 'punch_redemption' AND ((consumer_transaction.status = 'confirmed' AND coalesce(consumer_transaction.modeled_host_payout_centimos = 360, false)) OR (consumer_transaction.status IN ('pending', 'rejected', 'failed') AND consumer_transaction.modeled_host_payout_centimos IS NULL))) OR (consumer_transaction.operation IN ('emission', 'voucher_redemption') AND consumer_transaction.modeled_host_payout_centimos IS NULL))",
        );
        expect(generatedMigration).toContain(
            "CHECK ((consumer_transaction.operation = 'emission' AND consumer_transaction.proof_id IS NOT NULL AND consumer_transaction.redemption_request_id IS NULL) OR (consumer_transaction.operation IN ('punch_redemption', 'voucher_redemption') AND consumer_transaction.proof_id IS NULL AND consumer_transaction.redemption_request_id IS NOT NULL))",
        );
        expect(generatedMigration).toContain(
            "CHECK ((redemption_request.kind = 'punch_reward' AND redemption_request.product_id IS NOT NULL AND redemption_request.voucher_id IS NULL) OR (redemption_request.kind = 'voucher' AND redemption_request.product_id IS NULL AND redemption_request.voucher_id IS NOT NULL))",
        );
        expect(generatedMigration).toContain(
            "CHECK ((consumer_voucher.source = 'campaign' AND consumer_voucher.campaign_id IS NOT NULL AND consumer_voucher.crawl_id IS NULL) OR (consumer_voucher.source = 'crawl' AND consumer_voucher.campaign_id IS NULL AND consumer_voucher.crawl_id IS NOT NULL))",
        );
        expect(generatedMigration).toContain(
            "CHECK (campaign.window_start <= campaign.window_end)",
        );
        expect(generatedMigration).toContain(
            "CHECK (punch_balance_projection.balance >= 0)",
        );
        expect(generatedMigration).toContain(
            "CHECK (coffee_crawl_step.step_index >= 0)",
        );
        expect(generatedMigration).toContain(
            "CREATE UNIQUE INDEX consumer_transaction_proof_id_uq ON consumer_transaction USING btree (proof_id) WHERE consumer_transaction.proof_id IS NOT NULL",
        );
        expect(generatedMigration).toContain(
            "CREATE UNIQUE INDEX consumer_transaction_redemption_request_id_uq ON consumer_transaction USING btree (redemption_request_id) WHERE consumer_transaction.redemption_request_id IS NOT NULL",
        );
    });

    it("declares purchase quote lifecycle and safe linkage", () => {
        expect(consumptionProof.yapeRef).toBeDefined();
        expect(consumptionProof.purchaseOrderId).toBeDefined();
        expect(consumptionProof.failureReason).toBeDefined();
        expect(
            getTableConfig(consumptionProof).indexes.map(
                (index) => index.config.name,
            ),
        ).toContain("consumption_proof_purchase_order_uq");
        expect(generatedMigration).toContain(
            "ALTER TABLE consumption_proof ALTER COLUMN receipt_hash DROP NOT NULL",
        );
        expect(generatedMigration).toContain(
            "CREATE UNIQUE INDEX consumption_proof_purchase_order_uq",
        );
        expect(generatedMigration).toContain(
            "CHECK (((consumption_proof.status)::text <> ALL (ARRAY['submitted'::text, 'confirmed'::text])) OR (consumption_proof.consumer_user_id IS NOT NULL AND consumption_proof.purchase_order_id IS NOT NULL))",
        );
        expect(generatedMigration).toContain(
            "ALTER TYPE public.purchase_proof_status ADD VALUE 'expired'",
        );
        expect(generatedMigration).toContain(
            "UPDATE consumption_proof SET yape_ref = 'legacy-' || id WHERE yape_ref IS NULL",
        );
        expect(generatedMigration).toContain(
            "ALTER TABLE consumption_proof ALTER COLUMN yape_ref SET NOT NULL",
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
            "consumption_proof_submitted_binding",
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
        expect(
            getTableConfig(redemptionRequest).indexes.map(
                (index) => index.config.name,
            ),
        ).toContain("redemption_request_active_voucher_uq");
        expect(generatedMigration).toContain(
            "CREATE UNIQUE INDEX redemption_request_active_voucher_uq ON redemption_request USING btree (voucher_id) WHERE redemption_request.kind = 'voucher' AND redemption_request.status IN ('pending', 'approved') AND redemption_request.voucher_id IS NOT NULL",
        );
        expect(generatedMigration).toContain(
            "REFERENCES public.cafe(id) ON DELETE restrict ON UPDATE no action",
        );
        expect(generatedMigration).toContain(
            "REFERENCES public.cafe_product(id) ON DELETE restrict ON UPDATE no action",
        );
    });
});
