CREATE TYPE "public"."consumer_transaction_status" AS ENUM('pending', 'confirmed', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."consumption_operation" AS ENUM('emission', 'punch_redemption', 'voucher_redemption');--> statement-breakpoint
CREATE TYPE "public"."purchase_proof_status" AS ENUM('issued', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."redemption_request_kind" AS ENUM('punch_reward', 'voucher');--> statement-breakpoint
CREATE TYPE "public"."redemption_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."campaign_kind" AS ENUM('verified_acquisition');--> statement-breakpoint
CREATE TYPE "public"."crawl_progress_status" AS ENUM('in_progress', 'completed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."voucher_source" AS ENUM('campaign', 'crawl');--> statement-breakpoint
CREATE TYPE "public"."voucher_status" AS ENUM('available', 'redeemed', 'expired');--> statement-breakpoint
CREATE TABLE "consumer_transaction" (
	"id" text PRIMARY KEY NOT NULL,
	"operation" "consumption_operation" NOT NULL,
	"consumer_user_id" text NOT NULL,
	"cafe_id" text NOT NULL,
	"proof_id" text,
	"redemption_request_id" text,
	"chain_tx_id" text NOT NULL,
	"status" "consumer_transaction_status" DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consumption_proof" (
	"id" text PRIMARY KEY NOT NULL,
	"cafe_id" text NOT NULL,
	"product_id" text NOT NULL,
	"issued_by_user_id" text NOT NULL,
	"consumer_user_id" text,
	"amount_centimos" integer NOT NULL,
	"receipt_hash" text NOT NULL,
	"nonce" text NOT NULL,
	"cafe_signature" text NOT NULL,
	"consumer_signature" text,
	"status" "purchase_proof_status" DEFAULT 'issued' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "consumption_proof_amount_positive" CHECK ("consumption_proof"."amount_centimos" > 0)
);
--> statement-breakpoint
CREATE TABLE "redemption_request" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "redemption_request_kind" NOT NULL,
	"consumer_user_id" text NOT NULL,
	"cafe_id" text NOT NULL,
	"product_id" text,
	"voucher_id" text,
	"status" "redemption_request_status" DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"decided_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "campaign_kind" NOT NULL,
	"cafe_id" text NOT NULL,
	"name" text NOT NULL,
	"window_start" timestamp NOT NULL,
	"window_end" timestamp NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coffee_crawl" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coffee_crawl_step" (
	"id" text PRIMARY KEY NOT NULL,
	"crawl_id" text NOT NULL,
	"step_index" integer NOT NULL,
	"cafe_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consumer_crawl_progress" (
	"id" text PRIMARY KEY NOT NULL,
	"crawl_id" text NOT NULL,
	"consumer_user_id" text NOT NULL,
	"completed_cafe_ids" text[] DEFAULT '{}' NOT NULL,
	"status" "crawl_progress_status" DEFAULT 'in_progress' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "consumer_crawl_progress_balance_nonneg" CHECK (array_length("consumer_crawl_progress"."completed_cafe_ids", 1) is null or array_length("consumer_crawl_progress"."completed_cafe_ids", 1) >= 0)
);
--> statement-breakpoint
CREATE TABLE "consumer_voucher" (
	"id" text PRIMARY KEY NOT NULL,
	"source" "voucher_source" NOT NULL,
	"campaign_id" text,
	"crawl_id" text,
	"consumer_user_id" text NOT NULL,
	"cafe_id" text,
	"status" "voucher_status" DEFAULT 'available' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"redeemed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "punch_balance_projection" (
	"user_id" text PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consumer_transaction" ADD CONSTRAINT "consumer_transaction_consumer_user_id_user_id_fk" FOREIGN KEY ("consumer_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumer_transaction" ADD CONSTRAINT "consumer_transaction_cafe_id_cafe_id_fk" FOREIGN KEY ("cafe_id") REFERENCES "public"."cafe"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumer_transaction" ADD CONSTRAINT "consumer_transaction_proof_id_consumption_proof_id_fk" FOREIGN KEY ("proof_id") REFERENCES "public"."consumption_proof"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumption_proof" ADD CONSTRAINT "consumption_proof_cafe_id_cafe_id_fk" FOREIGN KEY ("cafe_id") REFERENCES "public"."cafe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumption_proof" ADD CONSTRAINT "consumption_proof_product_id_cafe_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."cafe_product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumption_proof" ADD CONSTRAINT "consumption_proof_issued_by_user_id_user_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumption_proof" ADD CONSTRAINT "consumption_proof_consumer_user_id_user_id_fk" FOREIGN KEY ("consumer_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemption_request" ADD CONSTRAINT "redemption_request_consumer_user_id_user_id_fk" FOREIGN KEY ("consumer_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemption_request" ADD CONSTRAINT "redemption_request_cafe_id_cafe_id_fk" FOREIGN KEY ("cafe_id") REFERENCES "public"."cafe"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemption_request" ADD CONSTRAINT "redemption_request_product_id_cafe_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."cafe_product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemption_request" ADD CONSTRAINT "redemption_request_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_cafe_id_cafe_id_fk" FOREIGN KEY ("cafe_id") REFERENCES "public"."cafe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coffee_crawl_step" ADD CONSTRAINT "coffee_crawl_step_crawl_id_coffee_crawl_id_fk" FOREIGN KEY ("crawl_id") REFERENCES "public"."coffee_crawl"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coffee_crawl_step" ADD CONSTRAINT "coffee_crawl_step_cafe_id_cafe_id_fk" FOREIGN KEY ("cafe_id") REFERENCES "public"."cafe"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumer_crawl_progress" ADD CONSTRAINT "consumer_crawl_progress_crawl_id_coffee_crawl_id_fk" FOREIGN KEY ("crawl_id") REFERENCES "public"."coffee_crawl"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumer_crawl_progress" ADD CONSTRAINT "consumer_crawl_progress_consumer_user_id_user_id_fk" FOREIGN KEY ("consumer_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumer_voucher" ADD CONSTRAINT "consumer_voucher_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumer_voucher" ADD CONSTRAINT "consumer_voucher_consumer_user_id_user_id_fk" FOREIGN KEY ("consumer_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumer_voucher" ADD CONSTRAINT "consumer_voucher_cafe_id_cafe_id_fk" FOREIGN KEY ("cafe_id") REFERENCES "public"."cafe"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_balance_projection" ADD CONSTRAINT "punch_balance_projection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consumer_transaction_idempotency_uq" ON "consumer_transaction" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "consumer_transaction_consumer_id_idx" ON "consumer_transaction" USING btree ("consumer_user_id");--> statement-breakpoint
CREATE INDEX "consumer_transaction_proof_id_idx" ON "consumer_transaction" USING btree ("proof_id");--> statement-breakpoint
CREATE UNIQUE INDEX "consumption_proof_nonce_uq" ON "consumption_proof" USING btree ("nonce");--> statement-breakpoint
CREATE UNIQUE INDEX "consumption_proof_receipt_hash_uq" ON "consumption_proof" USING btree ("receipt_hash");--> statement-breakpoint
CREATE INDEX "consumption_proof_cafe_id_idx" ON "consumption_proof" USING btree ("cafe_id");--> statement-breakpoint
CREATE INDEX "redemption_request_cafe_id_idx" ON "redemption_request" USING btree ("cafe_id");--> statement-breakpoint
CREATE INDEX "redemption_request_consumer_id_idx" ON "redemption_request" USING btree ("consumer_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coffee_crawl_step_crawl_index_uq" ON "coffee_crawl_step" USING btree ("crawl_id","step_index");--> statement-breakpoint
CREATE UNIQUE INDEX "consumer_crawl_progress_uq" ON "consumer_crawl_progress" USING btree ("crawl_id","consumer_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "consumer_voucher_campaign_unlock_uq" ON "consumer_voucher" USING btree ("campaign_id","consumer_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "consumer_voucher_crawl_unlock_uq" ON "consumer_voucher" USING btree ("crawl_id","consumer_user_id");