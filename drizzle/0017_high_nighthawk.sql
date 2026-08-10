CREATE TYPE "public"."campaign_projection_status" AS ENUM('draft', 'published', 'cancelled');--> statement-breakpoint
ALTER TABLE "relayer_job" DROP CONSTRAINT "relayer_job_target_check";--> statement-breakpoint
ALTER TABLE "relayer_job" ALTER COLUMN "kind" DROP DEFAULT;--> statement-breakpoint
ALTER TYPE "public"."relayer_job_kind" RENAME TO "relayer_job_kind_old";--> statement-breakpoint
CREATE TYPE "public"."relayer_job_kind" AS ENUM('consumption', 'consumption_record', 'punch_redemption', 'campaign_create', 'campaign_fund_approve', 'campaign_fund', 'campaign_publish', 'voucher_unlock', 'voucher_redeem');--> statement-breakpoint
ALTER TABLE "relayer_job" ALTER COLUMN "kind" TYPE "public"."relayer_job_kind" USING "kind"::text::"public"."relayer_job_kind";--> statement-breakpoint
ALTER TABLE "relayer_job" ALTER COLUMN "kind" SET DEFAULT 'consumption'::"public"."relayer_job_kind";--> statement-breakpoint
DROP TYPE "public"."relayer_job_kind_old";--> statement-breakpoint
CREATE TABLE "projection_campaign" (
	"chain_campaign_id" integer PRIMARY KEY NOT NULL,
	"status" "campaign_projection_status" NOT NULL,
	"budget" bigint NOT NULL,
	"voucher_payout" bigint DEFAULT 0 NOT NULL,
	"max_vouchers" integer DEFAULT 0 NOT NULL,
	"expiry" timestamp NOT NULL,
	"unlocked_count" integer DEFAULT 0 NOT NULL,
	"redeemed_count" integer DEFAULT 0 NOT NULL,
	"last_block" bigint NOT NULL,
	"last_transaction_index" integer DEFAULT 0 NOT NULL,
	"last_log_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "relayer_job" DROP CONSTRAINT "relayer_job_order_id_unique";--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN "chain_campaign_id" integer;--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN "voucher_payout" bigint;--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN "max_vouchers" integer;--> statement-breakpoint
ALTER TABLE "chain_purchase_effect" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "consumer_voucher" ADD COLUMN "chain_unlock_tx_hash" text;--> statement-breakpoint
ALTER TABLE "relayer_job" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
UPDATE "relayer_job" SET "idempotency_key" = CASE WHEN "kind" IN ('consumption', 'consumption_record') THEN 'consumption:' || COALESCE("order_id", "id") WHEN "kind" = 'punch_redemption' THEN 'punch_redemption:' || COALESCE("redemption_request_id", "id") ELSE "kind" || ':' || "id" END WHERE "idempotency_key" IS NULL;--> statement-breakpoint
ALTER TABLE "relayer_job" ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "relayer_job" ADD COLUMN "signed_tx" text;--> statement-breakpoint
CREATE UNIQUE INDEX "relayer_job_consumption_order_uq" ON "relayer_job" USING btree ("order_id") WHERE "relayer_job"."kind" in ('consumption', 'consumption_record');--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_chain_campaign_id_unique" UNIQUE("chain_campaign_id");--> statement-breakpoint
ALTER TABLE "relayer_job" ADD CONSTRAINT "relayer_job_idempotency_key_unique" UNIQUE("idempotency_key");--> statement-breakpoint
ALTER TABLE "relayer_job" ADD CONSTRAINT "relayer_job_target_check" CHECK ((("relayer_job"."kind" in ('consumption', 'consumption_record') AND "relayer_job"."order_id" IS NOT NULL AND "relayer_job"."redemption_request_id" IS NULL) OR ("relayer_job"."kind" = 'punch_redemption' AND "relayer_job"."redemption_request_id" IS NOT NULL AND "relayer_job"."order_id" IS NULL) OR ("relayer_job"."kind" in ('campaign_create', 'campaign_fund_approve', 'campaign_fund', 'campaign_publish', 'voucher_unlock', 'voucher_redeem') AND "relayer_job"."order_id" IS NULL AND "relayer_job"."redemption_request_id" IS NULL)));