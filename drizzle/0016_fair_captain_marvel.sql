CREATE TYPE "public"."plan_order_kind" AS ENUM('plan', 'pack');--> statement-breakpoint
CREATE TYPE "public"."plan_order_status" AS ENUM('pending', 'submitted', 'confirmed', 'failed');--> statement-breakpoint
CREATE TABLE "plan_order" (
	"id" text PRIMARY KEY NOT NULL,
	"cafe_id" text NOT NULL,
	"chain_cafe_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"kind" "plan_order_kind" NOT NULL,
	"price" bigint NOT NULL,
	"signer_address" text NOT NULL,
	"signer_wallet_index" integer NOT NULL,
	"status" "plan_order_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp DEFAULT now() NOT NULL,
	"tx_hash" text,
	"last_error" text,
	"failure_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plan_order_price_positive" CHECK ("plan_order"."price" > 0)
);
--> statement-breakpoint
ALTER TABLE "plan_order" ADD CONSTRAINT "plan_order_cafe_id_cafe_id_fk" FOREIGN KEY ("cafe_id") REFERENCES "public"."cafe"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_order" ADD CONSTRAINT "plan_order_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_order_cafe_created_idx" ON "plan_order" USING btree ("cafe_id","created_at");--> statement-breakpoint
CREATE INDEX "plan_order_status_retry_idx" ON "plan_order" USING btree ("status","next_retry_at");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_order_cafe_inflight_uq" ON "plan_order" USING btree ("cafe_id") WHERE "plan_order"."status" in ('pending', 'submitted');