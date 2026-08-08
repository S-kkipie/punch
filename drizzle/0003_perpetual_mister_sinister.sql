CREATE TYPE "public"."purchase_order_status" AS ENUM('user_confirmed', 'cafe_confirmed', 'queued', 'submitted', 'confirmed', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."relayer_job_status" AS ENUM('pending', 'submitted', 'confirmed', 'failed');--> statement-breakpoint
CREATE TABLE "indexer_cursor" (
	"contract" text PRIMARY KEY NOT NULL,
	"last_processed_block" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projection_cafe_credit" (
	"chain_cafe_id" integer PRIMARY KEY NOT NULL,
	"credits" bigint NOT NULL,
	"last_block" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projection_consumption" (
	"id" text PRIMARY KEY NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"chain_cafe_id" integer NOT NULL,
	"user_address" text NOT NULL,
	"receipt_hash" text NOT NULL,
	"block" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projection_punch_balance" (
	"user_address" text PRIMARY KEY NOT NULL,
	"balance" bigint NOT NULL,
	"last_block" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projection_status" (
	"projection" text PRIMARY KEY NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"last_good_block" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order" (
	"id" text PRIMARY KEY NOT NULL,
	"cafe_id" text NOT NULL,
	"user_id" text NOT NULL,
	"product_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"yape_ref" text NOT NULL,
	"receipt_hash" text NOT NULL,
	"nonce" text NOT NULL,
	"expiry" timestamp NOT NULL,
	"status" "purchase_order_status" DEFAULT 'user_confirmed' NOT NULL,
	"failure_reason" text,
	"tx_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_amount_positive" CHECK ("purchase_order"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "relayer_job" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp DEFAULT now() NOT NULL,
	"status" "relayer_job_status" DEFAULT 'pending' NOT NULL,
	"tx_hash" text,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "relayer_job_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
ALTER TABLE "cafe" ADD COLUMN "chain_cafe_id" integer;--> statement-breakpoint
ALTER TABLE "cafe_product" ADD COLUMN "chain_product_id" integer;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_cafe_id_cafe_id_fk" FOREIGN KEY ("cafe_id") REFERENCES "public"."cafe"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_product_id_cafe_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."cafe_product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relayer_job" ADD CONSTRAINT "relayer_job_order_id_purchase_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "projection_consumption_tx_log_uq" ON "projection_consumption" USING btree ("tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "purchase_order_cafe_status_idx" ON "purchase_order" USING btree ("cafe_id","status");--> statement-breakpoint
CREATE INDEX "purchase_order_user_idx" ON "purchase_order" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_cafe_receipt_uq" ON "purchase_order" USING btree ("cafe_id","receipt_hash");--> statement-breakpoint
CREATE INDEX "relayer_job_status_retry_idx" ON "relayer_job" USING btree ("status","next_retry_at");--> statement-breakpoint
ALTER TABLE "cafe" ADD CONSTRAINT "cafe_chain_cafe_id_unique" UNIQUE("chain_cafe_id");