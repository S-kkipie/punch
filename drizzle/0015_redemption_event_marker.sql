CREATE TABLE "projection_chain_event" (
  "tx_hash" text NOT NULL,
  "log_index" integer NOT NULL,
  "event_name" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "projection_chain_event_tx_log_uq" UNIQUE ("tx_hash", "log_index")
);
--> statement-breakpoint
