// Shared price rules for card (checkout.mjs) and crypto (crypto.mjs) bookings.
// Keep these numbers in sync with CFG in index.html.
export const CFG = {
  blocked: [["2026-11-20","2026-12-01"],["2026-12-02","2026-12-08"],["2026-12-12","2027-11-23"]],
  lastDate: "2027-11-22",
  weekday: 125, weekend: 152, weekendNights: [5, 6],
  guestExtra: { 3: 38, 4: 53 },
  discounts: [[28, 0.28], [7, 0.07]],
  maxGuests: 4, maxNights: 120,
};
export const DAY = 864e5;
export const parse = (k) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k || ""); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
export const key = (t) => new Date(t).toISOString().slice(0, 10);
const blocked = new Set();
for (const [a, b] of CFG.blocked) for (let t = parse(a); t < parse(b); t += DAY) blocked.add(key(t));
const extra = (g) => { let e = 0; for (let i = 3; i <= g; i++) e += CFG.guestExtra[i] || 0; return e; };

// Returns { cin, cout, g, n, sub, disc } or { error, status }.
export function priceStay(checkIn, checkOut, guests) {
  const cin = parse(checkIn), cout = parse(checkOut), g = Math.floor(Number(guests));
  const now = new Date(), today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (!Number.isFinite(cin) || !Number.isFinite(cout) || cout <= cin) return { error: "Please choose valid dates.", status: 400 };
  if (!(g >= 1 && g <= CFG.maxGuests)) return { error: "Up to 4 guests.", status: 400 };
  const n = Math.round((cout - cin) / DAY);
  if (n > CFG.maxNights) return { error: "For stays over 120 nights, please message us.", status: 400 };
  let sub = 0;
  for (let t = cin; t < cout; t += DAY) {
    if (t < today || t > parse(CFG.lastDate) || blocked.has(key(t))) return { error: "Some of those nights are no longer available. Please choose other dates.", status: 409 };
    sub += (CFG.weekendNights.includes(new Date(t).getUTCDay()) ? CFG.weekend : CFG.weekday) + extra(g);
  }
  let disc = 0; for (const [min, p] of CFG.discounts) if (n >= min) { disc = Math.round(sub * p * 100) / 100; break; }
  return { cin, cout, g, n, sub, disc };
}
