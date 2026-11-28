// Creates a Stripe Checkout session for a direct booking.
// The price is recalculated here from the same rules as the website calendar,
// so a visitor cannot change the amount they pay.
import { key, priceStay } from "../lib/pricing.mjs";
// Private test payment: open the site with ?testpay=<TEST_PAY_CODE> to pay a small fixed amount
// (TEST_PAY_PENCE, default 100 = £1, Stripe minimum is 30p). Works even while PAYMENTS_ENABLED is off,
// so the owner can test a real card and refund before guests see the button.
import { timingSafeEqual } from "node:crypto";
const isTest = (code) => {
  const want = process.env.TEST_PAY_CODE || "";
  if (want.length < 8 || typeof code !== "string" || code.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(code), Buffer.from(want));
};
const testPence = () => Math.max(30, Math.floor(Number(process.env.TEST_PAY_PENCE) || 100));
const keyMode = (k) => (/^(sk|rk)_live_/.test(k || "") ? "live" : /^(sk|rk)_test_/.test(k || "") ? "test" : "none");
// Discount codes. Only SHA-256 hashes are stored, so the public code does not reveal them.
// To add a code: run  printf %s "CODE" | sha256sum  and add a line here.
import { createHash } from "node:crypto";
const PROMOS = {
  "43f870f625677a868d0ac7a341780e027b590e88ae3952d4911808d0fbd65c9c": { type: "fixed", pence: 100, label: "Special price" }, // owner test code
  "1b32369945793aa89de9acc14a70fd7bd6d0bc61dab2d2251e186b6960e40a0d": { type: "percent", value: 10, label: "10% off" },
};
const normCode = (c) => String(c || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 40);
const promoFor = (c) => { const n = normCode(c); return n ? PROMOS[createHash("sha256").update(n).digest("hex")] || null : null; };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async (req) => {
  const secret = (process.env.STRIPE_SECRET_KEY || "").replace(/\s+/g, "");
  const mode = keyMode(secret);
  // Live for guests once a Stripe key is set. Set PAYMENTS_ENABLED=false in Netlify to switch off.
  const enabled = process.env.PAYMENTS_ENABLED !== "false" && mode !== "none";
  // GET tells the website whether to show the "Book now & pay" button, or checks a discount code. No secrets are returned.
  if (req.method === "GET") {
    const u = new URL(req.url);
    if (u.searchParams.has("promo")) {
      const p = promoFor(u.searchParams.get("promo"));
      return json(p ? { valid: true, type: p.type, value: p.type === "percent" ? p.value : p.pence / 100, label: p.label } : { valid: false });
    }
    const t = isTest(u.searchParams.get("testpay"));
    return json({ enabled: enabled || (t && mode !== "none"), test: t, mode: t ? mode : undefined });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let d; try { d = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const test = isTest(d.testCode);
  if (mode === "none") return json({ error: "Online payment is not set up yet. Please message us to book.", ...(test ? { key: secret ? `starts with "${secret.slice(0, 8)}", ${secret.length} characters` : "empty" } : {}) }, 503);
  // Online payment stays closed to guests until PAYMENTS_ENABLED=true in Netlify.
  if (!enabled && !test) return json({ error: "Online payment is not available yet. Please request to book or message us." }, 503);
  const P = priceStay(d.checkIn, d.checkOut, d.guests);
  if (P.error) return json({ error: P.error }, P.status);
  const { cin, cout, g, n, sub, disc } = P;
  const promo = promoFor(d.promo);
  let pence = Math.round((sub - disc) * 100);
  if (promo && promo.type === "percent") pence = Math.round(pence * (100 - promo.value) / 100);
  if (promo && promo.type === "fixed") pence = promo.pence;
  if (test) pence = testPence();
  pence = Math.max(30, pence);

  const origin = new URL(req.url).origin;
  const label = `${test ? "TEST PAYMENT · " : ""}${key(cin)} to ${key(cout)} · ${n} night${n > 1 ? "s" : ""} · ${g} guest${g > 1 ? "s" : ""}${promo ? ` · code ${normCode(d.promo)}` : ""}`;
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
    "metadata[promo]": promo ? normCode(d.promo) : "",
    "payment_intent_data[metadata][promo]": promo ? normCode(d.promo) : "",
    "metadata[full_price]": (sub - disc).toFixed(2),
    "metadata[test_payment]": test ? "yes" : "no",
    "payment_intent_data[metadata][test_payment]": test ? "yes" : "no",
    // Unpaid payment pages close after 35 minutes, so old links cannot be paid for dates taken since.
    expires_at: String(Math.floor(Date.now() / 1000) + 35 * 60),
    "phone_number_collection[enabled]": "true",
    "billing_address_collection": "required",
    success_url: `${origin}/?booking=success&session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/?booking=cancelled`,
  });
  const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/x-www-form-urlencoded" },
    body: f,
  });
  const s = await r.json().catch(() => ({}));
  if (!r.ok || !s.url) { console.error("Stripe error", r.status, s && s.error && s.error.message); return json({ error: "Payment page could not be opened. Please try again or message us.", ...(test ? { stripe: `${r.status} ${(s && s.error && s.error.message) || ""}` } : {}) }, 502); }
  return json({ url: s.url });
};

export const config = { path: "/api/checkout" };
