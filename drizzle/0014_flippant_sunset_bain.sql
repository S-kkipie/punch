CREATE TYPE "public"."relayer_job_kind" AS ENUM('consumption', 'punch_redemption');--> statement-breakpoint
ALTER TYPE "public"."redemption_request_status" ADD VALUE 'confirmed';--> statement-breakpoint
ALTER TYPE "public"."redemption_request_status" ADD VALUE 'failed';--> statement-breakpoint
CREATE TABLE "projection_cafe_payout" (
	"cafe_id" text PRIMARY KEY NOT NULL,
	"total_centimos" integer DEFAULT 0 NOT NULL,
	"redemption_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "relayer_job" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "redemption_request" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "relayer_job" ADD COLUMN "kind" "relayer_job_kind" DEFAULT 'consumption' NOT NULL;--> statement-breakpoint
ALTER TABLE "relayer_job" ADD COLUMN "redemption_request_id" text;--> statement-breakpoint
ALTER TABLE "projection_cafe_payout" ADD CONSTRAINT "projection_cafe_payout_cafe_id_cafe_id_fk" FOREIGN KEY ("cafe_id") REFERENCES "public"."cafe"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "redemption_request_active_punch_uq" ON "redemption_request" USING btree ("consumer_user_id") WHERE "redemption_request"."kind" = 'punch_reward' AND "redemption_request"."status" IN ('pending', 'approved');--> statement-breakpoint
ALTER TABLE "relayer_job" ADD CONSTRAINT "relayer_job_redemption_request_id_unique" UNIQUE("redemption_request_id");--> statement-breakpoint
ALTER TABLE "relayer_job" ADD CONSTRAINT "relayer_job_target_check" CHECK (("relayer_job"."kind" = 'consumption' AND "relayer_job"."order_id" IS NOT NULL AND "relayer_job"."redemption_request_id" IS NULL) OR ("relayer_job"."kind" = 'punch_redemption' AND "relayer_job"."redemption_request_id" IS NOT NULL AND "relayer_job"."order_id" IS NULL));--> statement-breakpoint
ALTER TABLE "relayer_job" ADD CONSTRAINT "relayer_job_redemption_request_id_fk" FOREIGN KEY ("redemption_request_id") REFERENCES "redemption_request"("id") ON DELETE restrict;