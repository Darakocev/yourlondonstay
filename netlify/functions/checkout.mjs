// Creates a Stripe Checkout session for a direct booking.
// The price is recalculated here from the same rules as the website calendar,
// so a visitor cannot change the amount they pay.
// Keep these numbers in sync with CFG in index.html.
const CFG = {
  blocked: [["2026-11-20","2026-12-01"],["2026-12-02","2026-12-08"],["2026-12-12","2027-11-23"]],
  lastDate: "2027-11-22",
  weekday: 125, weekend: 152, weekendNights: [5, 6],
  guestExtra: { 3: 38, 4: 53 },
  discounts: [[28, 0.28], [7, 0.07]],
  maxGuests: 4, maxNights: 120,
};
const DAY = 864e5;
const parse = (k) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k || ""); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
const key = (t) => new Date(t).toISOString().slice(0, 10);
const blocked = new Set();
for (const [a, b] of CFG.blocked) for (let t = parse(a); t < parse(b); t += DAY) blocked.add(key(t));
const extra = (g) => { let e = 0; for (let i = 3; i <= g; i++) e += CFG.guestExtra[i] || 0; return e; };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return json({ error: "Online payment is not set up yet. Please message us to book." }, 503);

  let d; try { d = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const cin = parse(d.checkIn), cout = parse(d.checkOut), g = Math.floor(Number(d.guests));
  const now = new Date(), today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (!Number.isFinite(cin) || !Number.isFinite(cout) || cout <= cin) return json({ error: "Please choose valid dates." }, 400);
  if (!(g >= 1 && g <= CFG.maxGuests)) return json({ error: "Up to 4 guests." }, 400);
  const n = Math.round((cout - cin) / DAY);
  if (n > CFG.maxNights) return json({ error: "For stays over 120 nights, please message us." }, 400);
  let sub = 0;
  for (let t = cin; t < cout; t += DAY) {
    if (t < today || t > parse(CFG.lastDate) || blocked.has(key(t))) return json({ error: "Some of those nights are no longer available. Please choose other dates." }, 409);
    sub += (CFG.weekendNights.includes(new Date(t).getUTCDay()) ? CFG.weekend : CFG.weekday) + extra(g);
  }
  let disc = 0; for (const [min, p] of CFG.discounts) if (n >= min) { disc = Math.round(sub * p * 100) / 100; break; }
  const pence = Math.round((sub - disc) * 100);

  const origin = new URL(req.url).origin;
  const label = `${key(cin)} to ${key(cout)} · ${n} night${n > 1 ? "s" : ""} · ${g} guest${g > 1 ? "s" : ""}`;
  const f = new URLSearchParams({
    mode: "payment",
    locale: "en-GB",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "gbp",
    "line_items[0][price_data][unit_amount]": String(pence),
    "line_items[0][price_data][product_data][name]": "Your London Stay, Hammersmith W6",
    "line_items[0][price_data][product_data][description]": label,
    // Card is authorised now and charged when the host confirms the dates (within 7 days).
    "payment_intent_data[capture_method]": "manual",
    "payment_intent_data[description]": `Your London Stay ${label}`,
    "payment_intent_data[metadata][check_in]": key(cin),
    "payment_intent_data[metadata][check_out]": key(cout),
    "payment_intent_data[metadata][guests]": String(g),
    "metadata[check_in]": key(cin),
    "metadata[check_out]": key(cout),
    "metadata[guests]": String(g),
    "phone_number_collection[enabled]": "true",
    "billing_address_collection": "required",
    success_url: `${origin}/?booking=success&session={CHECKOUT_SESSION_ID}#book`,
    cancel_url: `${origin}/?booking=cancelled#book`,
  });
  const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/x-www-form-urlencoded" },
    body: f,
  });
  const s = await r.json().catch(() => ({}));
  if (!r.ok || !s.url) { console.error("Stripe error", r.status, s && s.error && s.error.message); return json({ error: "Payment page could not be opened. Please try again or message us." }, 502); }
  return json({ url: s.url });
};

export const config = { path: "/api/checkout" };
