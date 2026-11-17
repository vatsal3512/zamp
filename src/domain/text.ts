/** Lowercase and keep only [a-z0-9] — strips currency symbols, separators, punctuation and whitespace. */
export function normalizeForQuote(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

/** Is the quote on the page? Exact normalised substring → 1, else the best sliding window of the quote's length. */
export function quoteFound(quote: string, pageText: string, min: number): { found: boolean; score: number } {
  const q = normalizeForQuote(quote);
  const t = normalizeForQuote(pageText);
  if (!q) return { found: false, score: 0 };
  if (t.includes(q)) return { found: true, score: 1 };
  let best = 0;
  if (t.length <= q.length) best = similarity(q, t);
  else for (let i = 0; i + q.length <= t.length; i++) best = Math.max(best, similarity(q, t.slice(i, i + q.length)));
  return { found: best >= min, score: best };
}

export function normalizeInvoiceNumber(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1));

/** Share of the name's tokens that appear in the text — "Northwind Labs" is fully contained in a bill-to block with an address. */
export function tokenContainment(name: string, text: string): number {
  const N = tokens(name);
  const T = tokens(text);
  if (N.size === 0) return 0;
  let inter = 0;
  for (const t of N) if (T.has(t)) inter++;
  return inter / N.size;
}

export function tokenJaccard(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}
