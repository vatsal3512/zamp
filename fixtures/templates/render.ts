/** HTML layouts for fixture documents. Each layout differs in header position, table style and tax presentation. */
import type { InvoiceDoc, DocLine, Party } from "../invoice-docs";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function money(n: number, cur: InvoiceDoc["currency"]) {
  const f = new Intl.NumberFormat(cur === "INR" ? "en-IN" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
  return `${n < 0 ? "-" : ""}${cur === "INR" ? "₹" : "$"}${f}`;
}
const num = (n: number | null) => (n === null ? "" : String(n));
const date = (iso: string | null) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
const period = (p: string | null) =>
  p ? new Date(`${p}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) : "";

const party = (p: Party, heading?: string) => `
  ${heading ? `<div class="label">${heading}</div>` : ""}
  <div class="pname">${esc(p.name)}</div>
  ${p.address.map((a) => `<div>${esc(a)}</div>`).join("")}
  ${p.taxId ? `<div>${p.taxId.startsWith("GSTIN") ? esc(p.taxId) : `Tax ID: ${esc(p.taxId)}`}</div>` : ""}
  ${p.email ? `<div>${esc(p.email)}</div>` : ""}`;

function meta(d: InvoiceDoc) {
  const rows: [string, string][] = [];
  const noLabel = d.layout === "credit" ? "Credit Note No." : "Invoice No.";
  if (d.invoiceNumber) rows.push([noLabel, d.invoiceNumber]);
  if (d.invoiceDate) rows.push([d.layout === "statement" ? "Statement Date" : d.layout === "credit" ? "Date" : "Invoice Date", date(d.invoiceDate)]);
  if (d.dueDate) rows.push(["Due Date", date(d.dueDate)]);
  if (d.poNumber) rows.push(["PO Number", d.poNumber]);
  if (d.servicePeriod) rows.push(["Service Period", period(d.servicePeriod)]);
  return rows.map(([k, v]) => `<tr><td class="k">${k}</td><td class="v">${esc(v)}</td></tr>`).join("");
}

function lineRows(d: InvoiceDoc, withHsn = false) {
  return d.lines
    .map((l: DocLine) => `<tr>
      <td>${esc(l.description)}</td>${withHsn ? `<td class="c">${l.hsn ?? ""}</td>` : ""}
      <td class="r">${num(l.qty)}</td>
      <td class="r">${l.unit === null ? "" : money(l.unit, d.currency)}</td>
      <td class="r">${money(l.amount, d.currency)}</td></tr>`)
    .join("");
}

function totals(d: InvoiceDoc) {
  const rows: string[] = [];
  if (d.subtotal !== null) rows.push(`<tr><td>Subtotal</td><td class="r">${money(d.subtotal, d.currency)}</td></tr>`);
  for (const t of d.taxes) rows.push(`<tr><td>${esc(t.label)}</td><td class="r">${money(t.amount, d.currency)}</td></tr>`);
  const label = d.layout === "credit" ? "Total Credit" : d.layout === "statement" ? "Balance Due" : "Total Due";
  rows.push(`<tr class="grand"><td>${label}</td><td class="r">${money(d.total, d.currency)}</td></tr>`);
  return `<table class="totals">${rows.join("")}</table>`;
}

function remit(d: InvoiceDoc) {
  if (!d.bank) return "";
  const b = d.bank;
  return `<div class="remit">
    ${b.label ? `<div class="alert">${esc(b.label)}</div>` : ""}
    <div class="label">Remit payment to</div>
    <div>${esc(b.bankName)}</div>
    <div>${d.currency === "INR" ? esc(b.routing) : `Routing (ABA): ${b.routing}`}</div>
    <div>Account: ${b.account}</div>
    <div>Account name: ${esc(d.vendor.name)}</div>
  </div>`;
}

const css = (accent: string, font: string) => `
  <style>
    * { box-sizing: border-box; }
    body { font-family: ${font}; color: #1f2328; font-size: 12px; margin: 0; padding: 48px 52px; }
    .label { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #6b7280; margin-bottom: 4px; }
    .pname { font-weight: 700; font-size: 13px; }
    h1 { margin: 0; font-size: 30px; letter-spacing: .04em; color: ${accent}; }
    table { border-collapse: collapse; width: 100%; }
    .meta td { padding: 2px 0; } .meta .k { color: #6b7280; padding-right: 16px; } .meta .v { font-weight: 600; text-align: right; }
    .items { margin-top: 28px; }
    .items th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #6b7280; padding: 8px 6px; }
    .items td { padding: 8px 6px; }
    .r { text-align: right; } .c { text-align: center; }
    .totals { width: 280px; margin-left: auto; margin-top: 16px; } .totals td { padding: 4px 6px; }
    .totals .grand td { font-weight: 700; font-size: 14px; border-top: 2px solid #1f2328; padding-top: 8px; }
    .remit { margin-top: 36px; padding: 12px 14px; border: 1px solid #d0d7de; width: 330px; line-height: 1.5; }
    .alert { color: #b42318; font-weight: 700; margin-bottom: 6px; }
    .note { margin-top: 20px; color: #374151; font-style: italic; }
    .row { display: flex; justify-content: space-between; gap: 32px; }
  </style>`;

function classic(d: InvoiceDoc) {
  return `${css("#1f2328", "Georgia, 'Times New Roman', serif")}
  <style>.items th, .items td { border: 1px solid #c9d1d9; } .items th { background: #f3f4f6; }</style>
  <div class="row"><div>${party(d.vendor)}</div><div><h1>${d.title}</h1><table class="meta">${meta(d)}</table></div></div>
  <div style="margin-top:28px">${party(d.billTo, "Bill to")}</div>
  <table class="items"><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit Price</th><th class="r">Amount</th></tr>${lineRows(d)}</table>
  ${totals(d)}${d.note ? `<div class="note">${esc(d.note)}</div>` : ""}${remit(d)}`;
}

function modern(d: InvoiceDoc) {
  return `${css("#ffffff", "'Segoe UI', Arial, sans-serif")}
  <style>.band { background:#0f3d5e; color:#fff; margin:-48px -52px 28px; padding:28px 52px; display:flex; justify-content:space-between; align-items:center; }
  .band .pname { color:#fff; font-size:18px; } .items tr:nth-child(even) td { background:#f6f8fa; } .items th { border-bottom:2px solid #0f3d5e; }</style>
  <div class="band"><div class="pname">${esc(d.vendor.name)}</div><h1>${d.title}</h1></div>
  <div class="row"><div>${party(d.vendor, "From")}</div><div>${party(d.billTo, "Bill to")}</div><div><table class="meta">${meta(d)}</table></div></div>
  <table class="items"><tr><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Line Total</th></tr>${lineRows(d)}</table>
  ${totals(d)}${d.note ? `<div class="note">${esc(d.note)}</div>` : ""}${remit(d)}`;
}

function minimal(d: InvoiceDoc) {
  return `${css("#111111", "Helvetica, Arial, sans-serif")}
  <style>.items th { border-bottom:1px solid #111; } .items td { border-bottom:1px solid #e5e7eb; } h1 { font-weight:300; font-size:36px; }</style>
  <h1>${d.title.toLowerCase()}</h1>
  <div class="row" style="margin-top:24px"><div>${party(d.vendor)}</div><div>${party(d.billTo, "Billed to")}</div><div><table class="meta">${meta(d)}</table></div></div>
  <table class="items"><tr><th>Description</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Total</th></tr>${lineRows(d)}</table>
  ${totals(d)}${d.note ? `<div class="note">${esc(d.note)}</div>` : ""}${remit(d)}`;
}

function gst(d: InvoiceDoc) {
  return `${css("#7a1f1f", "Arial, sans-serif")}
  <style>.items th, .items td { border:1px solid #999; } .items th { background:#f2e8e8; }</style>
  <div class="row"><div>${party(d.vendor)}</div><div><h1>${d.title}</h1><table class="meta">${meta(d)}</table><div style="margin-top:6px">Place of supply: Karnataka (29)</div></div></div>
  <div style="margin-top:24px">${party(d.billTo, "Bill to / Ship to")}</div>
  <table class="items"><tr><th>Description of goods</th><th class="c">HSN</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Taxable value</th></tr>${lineRows(d, true)}</table>
  ${totals(d)}<div class="note">Amount chargeable in INR. E. &amp; O.E.</div>${remit(d)}`;
}

function statement(d: InvoiceDoc) {
  let bal = 0;
  const rows = d.lines.map((l) => { bal += l.amount; return `<tr><td>${esc(l.description)}</td><td class="r">${money(l.amount, d.currency)}</td><td class="r">${money(bal, d.currency)}</td></tr>`; }).join("");
  return `${css("#1f2328", "Helvetica, Arial, sans-serif")}
  <style>.items th { border-bottom:2px solid #1f2328; } .items td { border-bottom:1px solid #e5e7eb; }</style>
  <div class="row"><div>${party(d.vendor)}</div><div><h1>${d.title}</h1><table class="meta">${meta(d)}</table></div></div>
  <div style="margin-top:24px">${party(d.billTo, "Account")}</div>
  <table class="items"><tr><th>Activity — October 2026</th><th class="r">Amount</th><th class="r">Balance</th></tr>${rows}</table>
  ${totals(d)}<div class="note">${esc(d.note ?? "")}</div>`;
}

const LAYOUTS = { classic, modern, minimal, gst, statement, credit: classic };

export function renderDoc(d: InvoiceDoc): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${LAYOUTS[d.layout](d)}</body></html>`;
}
