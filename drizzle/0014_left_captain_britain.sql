CREATE TYPE "public"."relayer_job_kind" AS ENUM('consumption_record', 'campaign_create', 'campaign_fund_approve', 'campaign_fund', 'campaign_publish', 'voucher_unlock', 'voucher_redeem');--> statement-breakpoint
ALTER TABLE "relayer_job" DROP CONSTRAINT "relayer_job_order_id_unique";--> statement-breakpoint
ALTER TABLE "relayer_job" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "relayer_job" ADD COLUMN "kind" "relayer_job_kind" DEFAULT 'consumption_record' NOT NULL;--> statement-breakpoint
ALTER TABLE "relayer_job" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
UPDATE "relayer_job" SET "idempotency_key" = 'consumption:' || "order_id" WHERE "idempotency_key" IS NULL;--> statement-breakpoint
ALTER TABLE "relayer_job" ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "relayer_job_consumption_order_uq" ON "relayer_job" USING btree ("order_id") WHERE "relayer_job"."kind" = 'consumption_record';--> statement-breakpoint
ALTER TABLE "relayer_job" ADD CONSTRAINT "relayer_job_idempotency_key_unique" UNIQUE("idempotency_key");