CREATE TYPE "public"."cafe_member_role" AS ENUM('owner', 'barista');--> statement-breakpoint
CREATE SEQUENCE "public"."wallet_index_seq" INCREMENT BY 1 MINVALUE 0 MAXVALUE 9223372036854775807 START WITH 0 CACHE 1;--> statement-breakpoint
CREATE TABLE "cafe_member" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"cafe_id" text NOT NULL,
	"role" "cafe_member_role" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "wallet_index" integer;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "wallet_address" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "is_ops" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cafe_member" ADD CONSTRAINT "cafe_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cafe_member_user_cafe_uq" ON "cafe_member" USING btree ("user_id","cafe_id");--> statement-breakpoint
CREATE INDEX "cafe_member_cafe_id_idx" ON "cafe_member" USING btree ("cafe_id");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_wallet_index_unique" UNIQUE("wallet_index");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_wallet_address_unique" UNIQUE("wallet_address");