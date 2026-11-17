/**
 * A routine vendor letter that lands in AP inboxes but is not a bill: holiday closure and year-end billing cut-off.
 * Dates and contacts, no amounts. Used by the "Not an invoice" scenario (R-DOC-02).
 */
export function renderNotice(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { size: Letter; margin: 0; }
  body { margin: 0; font-family: Georgia, "Times New Roman", serif; color: #1d1d1b; }
  .page { padding: 72px 84px; font-size: 13.5px; line-height: 1.55; }
  .brand { font-family: Helvetica, Arial, sans-serif; font-weight: 700; font-size: 20px; letter-spacing: .02em; }
  .addr { font-family: Helvetica, Arial, sans-serif; font-size: 11px; color: #555; margin-top: 4px; }
  hr { border: 0; border-top: 2px solid #1d1d1b; margin: 18px 0 30px; }
  h1 { font-size: 18px; margin: 28px 0 18px; }
  table { border-collapse: collapse; margin: 12px 0 18px; font-family: Helvetica, Arial, sans-serif; font-size: 12px; }
  td { padding: 6px 18px 6px 0; border-bottom: 1px solid #ddd; }
  .sig { margin-top: 36px; }
</style></head><body><div class="page">
  <div class="brand">UMBRELLA PRINT CO.</div>
  <div class="addr">455 Industrial Way · Columbus, OH 43215 · ar@umbrellaprint.com</div>
  <hr />
  <div>November 14, 2026</div>
  <div style="margin-top:18px">Accounts Payable<br/>Northwind Labs, Inc.<br/>500 Howard Street, Suite 300<br/>San Francisco, CA 94105</div>
  <h1>Notice: holiday closure and year-end billing cut-off</h1>
  <p>Dear valued customer,</p>
  <p>Thank you for your business this year. Please note the following dates so that your December orders are
  billed and delivered on time.</p>
  <table>
    <tr><td>Last day for orders to ship in 2026</td><td>December 18, 2026</td></tr>
    <tr><td>Office closed</td><td>December 24, 2026 – January 1, 2027</td></tr>
    <tr><td>Final 2026 billing run</td><td>December 21, 2026</td></tr>
    <tr><td>Normal operations resume</td><td>January 4, 2027</td></tr>
  </table>
  <p>This letter is for information only and is not a request for payment. Invoices for December shipments
  will be sent separately and will reference your purchase order numbers as usual. Our remittance details are
  unchanged.</p>
  <p>Questions? Contact our accounts receivable team at ar@umbrellaprint.com.</p>
  <div class="sig">Warm regards,<br/><br/>Dana Whitfield<br/>Customer Accounts Manager, Umbrella Print Co.</div>
</div></body></html>`;
}
