CREATE TYPE "public"."chain_purchase_effect_kind" AS ENUM('campaign_qualification', 'crawl_step');--> statement-breakpoint
CREATE TABLE "chain_purchase_effect" (
	"id" text PRIMARY KEY NOT NULL,
	"purchase_order_id" text NOT NULL,
	"kind" "chain_purchase_effect_kind" NOT NULL,
	"target_id" text NOT NULL,
	"transaction_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consumer_transaction" ADD COLUMN "purchase_order_id" text;--> statement-breakpoint
ALTER TABLE "consumer_transaction" ADD COLUMN "transaction_hash" text;--> statement-breakpoint
ALTER TABLE "consumer_transaction" ADD COLUMN "log_index" integer;--> statement-breakpoint
ALTER TABLE "chain_purchase_effect" ADD CONSTRAINT "chain_purchase_effect_purchase_order_id_purchase_order_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chain_purchase_effect_order_kind_target_uq" ON "chain_purchase_effect" USING btree ("purchase_order_id","kind","target_id");--> statement-breakpoint
ALTER TABLE "consumer_transaction" ADD CONSTRAINT "consumer_transaction_purchase_order_id_purchase_order_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consumer_transaction_purchase_order_uq" ON "consumer_transaction" USING btree ("purchase_order_id") WHERE "consumer_transaction"."purchase_order_id" IS NOT NULL;