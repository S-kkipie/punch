CREATE TYPE "public"."cafe_onboarding_status" AS ENUM('draft', 'submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."cafe_product_type" AS ENUM('emission', 'reward');--> statement-breakpoint
CREATE TYPE "public"."product_approval_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "cafe" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"address" text,
	"district" text,
	"lat" numeric,
	"lng" numeric,
	"photo_url" text,
	"ruc" text,
	"contact_phone" text,
	"onboarding_status" "cafe_onboarding_status" DEFAULT 'draft' NOT NULL,
	"review_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cafe_slug_unique" UNIQUE("slug"),
	CONSTRAINT "cafe_name_not_empty" CHECK (length(trim("cafe"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "cafe_product" (
	"id" text PRIMARY KEY NOT NULL,
	"cafe_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_soles" numeric NOT NULL,
	"cogs_soles" numeric,
	"type" "cafe_product_type" NOT NULL,
	"approval_status" "product_approval_status" DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cafe_product_price_positive" CHECK ("cafe_product"."price_soles" > 0),
	CONSTRAINT "cafe_product_reward_price_cap" CHECK ("cafe_product"."type" <> 'reward' OR "cafe_product"."price_soles" <= 12)
);
--> statement-breakpoint
ALTER TABLE "cafe_product" ADD CONSTRAINT "cafe_product_cafe_id_cafe_id_fk" FOREIGN KEY ("cafe_id") REFERENCES "public"."cafe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cafe_onboarding_status_idx" ON "cafe" USING btree ("onboarding_status");--> statement-breakpoint
CREATE INDEX "cafe_product_cafe_id_idx" ON "cafe_product" USING btree ("cafe_id");--> statement-breakpoint
ALTER TABLE "cafe_member" ADD CONSTRAINT "cafe_member_cafe_id_cafe_id_fk" FOREIGN KEY ("cafe_id") REFERENCES "public"."cafe"("id") ON DELETE cascade ON UPDATE no action;