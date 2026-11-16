import { bigint, boolean, customType, integer, jsonb, pgTable, primaryKey, serial, text, timestamp } from "drizzle-orm/pg-core";
import type { Decision, ExtractedInvoice, GoodsReceipt, PoLine, Policy, RunEvent } from "@/domain/types";

const bytea = customType<{ data: Uint8Array; driverData: Buffer | Uint8Array }>({
  dataType: () => "bytea",
  toDriver: (v) => Buffer.from(v),
  fromDriver: (v) => new Uint8Array(v),
});
const cents = (name: string) => bigint(name, { mode: "number" });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });

export const vendors = pgTable("vendors", {
  id: text("id").primaryKey(),
  legalName: text("legal_name").notNull(),
  aliases: jsonb("aliases").$type<string[]>().notNull(),
  taxId: text("tax_id").notNull(),
  status: text("status").$type<"approved" | "blocked" | "suspended" | "onboarding">().notNull(),
  bankAccount: text("bank_account").notNull(),
  emailDomain: text("email_domain").notNull(),
  contactOnFile: text("contact_on_file").notNull(),
});

export const purchaseOrders = pgTable("purchase_orders", {
  poNumber: text("po_number").primaryKey(),
  vendorId: text("vendor_id").notNull(),
  matchType: text("match_type").$type<"2-way" | "3-way">().notNull(),
  currency: text("currency").notNull(),
  lines: jsonb("lines").$type<PoLine[]>().notNull(),
  totalCents: cents("total_cents").notNull(),
  billedToDateCents: cents("billed_to_date_cents").notNull(),
  status: text("status").$type<"open" | "closed" | "cancelled">().notNull(),
});

export const goodsReceipts = pgTable("goods_receipts", {
  grnNumber: text("grn_number").primaryKey(),
  poNumber: text("po_number").notNull(),
  receivedAt: text("received_at").notNull(),
  lines: jsonb("lines").$type<GoodsReceipt["lines"]>().notNull(),
});

export const documents = pgTable("documents", {
  id: text("id").primaryKey(),
  filename: text("filename").notNull(),
  bytes: bytea("bytes").notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
});

export const inboxMessages = pgTable("inbox_messages", {
  id: text("id").primaryKey(),
  scenarioTag: text("scenario_tag").notNull(),
  from: text("from_address").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  receivedAt: text("received_at").notNull(),
  documentId: text("document_id").notNull(),
  sortOrder: integer("sort_order").notNull(),
});

export const invoices = pgTable("invoices", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  documentId: text("document_id").notNull(),
  vendorId: text("vendor_id"),
  poNumber: text("po_number"),
  invoiceNumber: text("invoice_number"),
  invoiceDate: text("invoice_date"),
  extracted: jsonb("extracted").$type<ExtractedInvoice | null>(),
  totalCents: cents("total_cents"),
  servicePeriod: text("service_period"),
  lineDescriptions: jsonb("line_descriptions").$type<string[]>().notNull(),
  outcome: text("outcome").notNull(),
  sha256: text("sha256").notNull(),
  posted: boolean("posted").default(false).notNull(),
  postedAmountCents: cents("posted_amount_cents").default(0).notNull(),
});

export const runs = pgTable("runs", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull(),
  source: text("source").$type<"inbox" | "upload" | "rerun">().notNull(),
  rerunOf: text("rerun_of"),
  outcome: text("outcome"),
  decision: jsonb("decision").$type<Decision | null>(),
  policyVersion: integer("policy_version").notNull(),
  model: text("model"),
  cached: boolean("cached").default(false).notNull(),
  durationMs: integer("duration_ms"),
  startedAt: ts("started_at").defaultNow().notNull(),
  overrideAction: text("override_action"),
  overrideReason: text("override_reason"),
  overrideAt: ts("override_at"),
});

export const runEvents = pgTable("run_events", {
  runId: text("run_id").notNull(),
  seq: integer("seq").notNull(),
  stage: text("stage").$type<RunEvent["stage"]>().notNull(),
  type: text("type").$type<RunEvent["type"]>().notNull(),
  at: text("at").notNull(),
  durationMs: integer("duration_ms"),
  data: jsonb("data"),
}, (t) => [primaryKey({ columns: [t.runId, t.seq] })]);

export const priorInvoices = pgTable("prior_invoices", {
  invoiceId: text("invoice_id").primaryKey(),
  vendorId: text("vendor_id").notNull(),
  invoiceNumber: text("invoice_number").notNull(),
  invoiceDate: text("invoice_date").notNull(),
  totalCents: cents("total_cents").notNull(),
  servicePeriod: text("service_period"),
  lineDescriptions: jsonb("line_descriptions").$type<string[]>().notNull(),
  outcome: text("outcome").notNull(),
  sha256: text("sha256").notNull(),
});

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  at: ts("at").defaultNow().notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
});

export const policies = pgTable("policies", {
  version: integer("version").primaryKey(),
  body: jsonb("body").$type<Omit<Policy, "version">>().notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
});

export const extractionCache = pgTable("extraction_cache", {
  key: text("key").primaryKey(),
  model: text("model").notNull(),
  body: jsonb("body").$type<ExtractedInvoice>().notNull(),
});

export const uploadChunks = pgTable("upload_chunks", {
  uploadId: text("upload_id").notNull(),
  idx: integer("idx").notNull(),
  bytes: bytea("bytes").notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.uploadId, t.idx] })]);
