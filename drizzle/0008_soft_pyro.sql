ALTER TABLE "consumption_proof" DROP CONSTRAINT "consumption_proof_cafe_id_cafe_id_fk";
--> statement-breakpoint
ALTER TABLE "consumption_proof" DROP CONSTRAINT "consumption_proof_product_id_cafe_product_id_fk";
--> statement-breakpoint
ALTER TABLE "campaign" DROP CONSTRAINT "campaign_cafe_id_cafe_id_fk";
--> statement-breakpoint
ALTER TABLE "consumption_proof" ADD CONSTRAINT "consumption_proof_cafe_id_cafe_id_fk" FOREIGN KEY ("cafe_id") REFERENCES "public"."cafe"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumption_proof" ADD CONSTRAINT "consumption_proof_product_id_cafe_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."cafe_product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_cafe_id_cafe_id_fk" FOREIGN KEY ("cafe_id") REFERENCES "public"."cafe"("id") ON DELETE restrict ON UPDATE no action;