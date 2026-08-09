CREATE TYPE "public"."campaign_projection_status" AS ENUM('draft', 'published', 'cancelled');--> statement-breakpoint
CREATE TABLE "projection_campaign" (
	"chain_campaign_id" integer PRIMARY KEY NOT NULL,
	"status" "campaign_projection_status" NOT NULL,
	"budget" bigint NOT NULL,
	"voucher_payout" bigint DEFAULT 0 NOT NULL,
	"max_vouchers" integer DEFAULT 0 NOT NULL,
	"expiry" timestamp NOT NULL,
	"unlocked_count" integer DEFAULT 0 NOT NULL,
	"redeemed_count" integer DEFAULT 0 NOT NULL,
	"last_block" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN "chain_campaign_id" integer;--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN "voucher_payout" bigint;--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN "max_vouchers" integer;--> statement-breakpoint
ALTER TABLE "chain_purchase_effect" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "consumer_voucher" ADD COLUMN "chain_unlock_tx_hash" text;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_chain_campaign_id_unique" UNIQUE("chain_campaign_id");