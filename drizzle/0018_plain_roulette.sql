ALTER TABLE "relayer_job" DROP CONSTRAINT "relayer_job_target_check";--> statement-breakpoint
DROP INDEX "relayer_job_consumption_order_uq";--> statement-breakpoint
ALTER TABLE "relayer_job" ALTER COLUMN "kind" DROP DEFAULT;--> statement-breakpoint
ALTER TYPE "public"."relayer_job_kind" RENAME TO "relayer_job_kind_old";--> statement-breakpoint
CREATE TYPE "public"."relayer_job_kind" AS ENUM('consumption', 'consumption_record', 'punch_redemption', 'campaign_create', 'campaign_fund_approve', 'campaign_fund', 'campaign_publish', 'voucher_unlock', 'voucher_redeem', 'referral_record');--> statement-breakpoint
ALTER TABLE "relayer_job" ALTER COLUMN "kind" TYPE "public"."relayer_job_kind" USING "kind"::text::"public"."relayer_job_kind";--> statement-breakpoint
ALTER TABLE "relayer_job" ALTER COLUMN "kind" SET DEFAULT 'consumption'::"public"."relayer_job_kind";--> statement-breakpoint
DROP TYPE "public"."relayer_job_kind_old";--> statement-breakpoint
CREATE UNIQUE INDEX "relayer_job_consumption_order_uq" ON "relayer_job" USING btree ("order_id") WHERE "relayer_job"."kind" in ('consumption', 'consumption_record');--> statement-breakpoint
ALTER TABLE "relayer_job" ADD CONSTRAINT "relayer_job_target_check" CHECK ((("relayer_job"."kind" in ('consumption', 'consumption_record') AND "relayer_job"."order_id" IS NOT NULL AND "relayer_job"."redemption_request_id" IS NULL) OR ("relayer_job"."kind" = 'punch_redemption' AND "relayer_job"."redemption_request_id" IS NOT NULL AND "relayer_job"."order_id" IS NULL) OR ("relayer_job"."kind" in ('campaign_create', 'campaign_fund_approve', 'campaign_fund', 'campaign_publish', 'voucher_unlock', 'voucher_redeem', 'referral_record') AND "relayer_job"."order_id" IS NULL AND "relayer_job"."redemption_request_id" IS NULL)));--> statement-breakpoint
