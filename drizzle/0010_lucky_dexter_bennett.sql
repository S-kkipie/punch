ALTER TYPE "public"."purchase_proof_status" ADD VALUE 'submitted' BEFORE 'confirmed';--> statement-breakpoint
ALTER TYPE "public"."purchase_proof_status" ADD VALUE 'failed';--> statement-breakpoint
ALTER TYPE "public"."purchase_proof_status" ADD VALUE 'expired';--> statement-breakpoint
ALTER TABLE "consumption_proof" DROP CONSTRAINT "consumption_proof_confirmed_binding";--> statement-breakpoint
ALTER TABLE "consumption_proof" ALTER COLUMN "receipt_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "consumption_proof" ALTER COLUMN "nonce" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "consumption_proof" ALTER COLUMN "cafe_signature" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "consumption_proof" ADD COLUMN "purchase_order_id" text;--> statement-breakpoint
ALTER TABLE "consumption_proof" ADD COLUMN "yape_ref" text;--> statement-breakpoint
UPDATE consumption_proof SET yape_ref = 'legacy-' || id WHERE yape_ref IS NULL;--> statement-breakpoint
ALTER TABLE "consumption_proof" ALTER COLUMN "yape_ref" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "consumption_proof" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "consumption_proof" ADD CONSTRAINT "consumption_proof_purchase_order_id_purchase_order_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consumption_proof_purchase_order_uq" ON "consumption_proof" USING btree ("purchase_order_id") WHERE "consumption_proof"."purchase_order_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "consumption_proof" ADD CONSTRAINT "consumption_proof_submitted_binding" CHECK ((("consumption_proof"."status")::text <> ALL (ARRAY['submitted'::text, 'confirmed'::text])) OR ("consumption_proof"."consumer_user_id" IS NOT NULL AND "consumption_proof"."purchase_order_id" IS NOT NULL));