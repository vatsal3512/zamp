CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extraction_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"body" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"grn_number" text PRIMARY KEY NOT NULL,
	"po_number" text NOT NULL,
	"received_at" text NOT NULL,
	"lines" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"scenario_tag" text NOT NULL,
	"from_address" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"received_at" text NOT NULL,
	"document_id" text NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"document_id" text NOT NULL,
	"vendor_id" text,
	"po_number" text,
	"invoice_number" text,
	"invoice_date" text,
	"extracted" jsonb,
	"total_cents" bigint,
	"service_period" text,
	"line_descriptions" jsonb NOT NULL,
	"outcome" text NOT NULL,
	"sha256" text NOT NULL,
	"posted" boolean DEFAULT false NOT NULL,
	"posted_amount_cents" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"version" integer PRIMARY KEY NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prior_invoices" (
	"invoice_id" text PRIMARY KEY NOT NULL,
	"vendor_id" text NOT NULL,
	"invoice_number" text NOT NULL,
	"invoice_date" text NOT NULL,
	"total_cents" bigint NOT NULL,
	"service_period" text,
	"line_descriptions" jsonb NOT NULL,
	"outcome" text NOT NULL,
	"sha256" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"po_number" text PRIMARY KEY NOT NULL,
	"vendor_id" text NOT NULL,
	"match_type" text NOT NULL,
	"currency" text NOT NULL,
	"lines" jsonb NOT NULL,
	"total_cents" bigint NOT NULL,
	"billed_to_date_cents" bigint NOT NULL,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"run_id" text NOT NULL,
	"seq" integer NOT NULL,
	"stage" text NOT NULL,
	"type" text NOT NULL,
	"at" text NOT NULL,
	"duration_ms" integer,
	"data" jsonb,
	CONSTRAINT "run_events_run_id_seq_pk" PRIMARY KEY("run_id","seq")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"source" text NOT NULL,
	"rerun_of" text,
	"outcome" text,
	"decision" jsonb,
	"policy_version" integer NOT NULL,
	"model" text,
	"cached" boolean DEFAULT false NOT NULL,
	"duration_ms" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"override_action" text,
	"override_reason" text,
	"override_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "upload_chunks" (
	"upload_id" text NOT NULL,
	"idx" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_chunks_upload_id_idx_pk" PRIMARY KEY("upload_id","idx")
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" text PRIMARY KEY NOT NULL,
	"legal_name" text NOT NULL,
	"aliases" jsonb NOT NULL,
	"tax_id" text NOT NULL,
	"status" text NOT NULL,
	"bank_account" text NOT NULL,
	"email_domain" text NOT NULL,
	"contact_on_file" text NOT NULL
);
