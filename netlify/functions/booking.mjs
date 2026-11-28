// Called by the website when a guest returns from Stripe after paying.
// Checks the Checkout Session with Stripe and, once per booking:
//  - records it as a Netlify Forms submission ("booking"),
//  - emails the owner the booking details and emails the guest a confirmation (FormSubmit autoresponse).
// Returns a short summary so the website can show the confirmation screen.
import { getStore } from "@netlify/blobs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const DAY = 864e5;
const fmt = (k) => { const t = Date.parse(k + "T00:00:00Z"); return Number.isFinite(t) ? new Date(t).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : k; };
const summary = (r) => ({
  ok: true,
  ref: r.reference,
  check_in: r.check_in,
  check_out: r.check_out,
  nights: r.nights,
  guests: r.guests,
  amount: r.amount_paid,
  code: r.discount_code || "",
  first_name: (r.guest_name || "").split(" ")[0],
  email: r.guest_email || "",
});

export default async (req) => {
  const id = new URL(req.url).searchParams.get("session_id") || "";
  if (!/^cs_(live|test)_[A-Za-z0-9]{10,200}$/.test(id)) return json({ ok: false }, 400);
  const secret = (process.env.STRIPE_SECRET_KEY || "").replace(/\s+/g, "");
  if (!secret) return json({ ok: false }, 503);

  const store = getStore("bookings");
  const saved = await store.get(id, { type: "json" });
  if (saved) return json(summary(saved));

  const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${id}`, { headers: { authorization: `Bearer ${secret}` } });
  const s = await r.json().catch(() => ({}));
  if (!r.ok) { console.error("Stripe session read failed", r.status, s && s.error && s.error.message); return json({ ok: false }, 502); }
  if (s.status !== "complete") return json({ ok: false, status: s.status }, 409);

  const m = s.metadata || {};
  const c = s.customer_details || {};
  const piId = typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent && s.payment_intent.id) || "";
  const nights = Math.round((Date.parse(m.check_out) - Date.parse(m.check_in)) / DAY) || "";
  const rec = {
    reference: "YLS-" + id.slice(-6).toUpperCase(),
    check_in: m.check_in || "",
    check_out: m.check_out || "",
    nights: String(nights),
    guests: m.guests || "",
    amount_paid: `£${((s.amount_total || 0) / 100).toFixed(2)}`,
    full_price: m.full_price ? `£${m.full_price}` : "",
    discount_code: m.promo || "",
    payment_status: s.payment_status === "paid" ? "paid" : "card held - capture in Stripe to charge",
    guest_name: c.name || "",
    guest_email: c.email || "",
    guest_phone: c.phone || "",
    stripe_link: piId ? `https://dashboard.stripe.com/${s.livemode ? "" : "test/"}payments/${piId}` : "",
    session: id,
  };
  await store.setJSON(id, { ...rec, at: new Date().toISOString() });

  const origin = new URL(req.url).origin;
  const f = await fetch(`${origin}/`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ "form-name": "booking", ...rec }).toString() }).catch((e) => ({ ok: false, status: String(e) }));
  if (!f.ok) console.error("Booking form submission failed", f.status);

  // Owner email with all details (approved by the owner) + guest confirmation:
  // FormSubmit sends _autoresponse to the address in the "email" field. Free, no account;
  // the very first email asks the owner to activate once.
  const to = process.env.BOOKING_EMAIL || "4yourlondonstay@gmail.com";
  const first = (rec.guest_name || "").split(" ")[0] || "there";
  const guestText =
    `Hello ${first},\n\nThank you for booking Your London Stay, Hammersmith W6.\n\n` +
    `Booking reference: ${rec.reference}\nCheck-in: ${fmt(rec.check_in)} (from 12:00)\nCheck-out: ${fmt(rec.check_out)} (by 11:00)\n` +
    `Nights: ${rec.nights}\nGuests: ${rec.guests}\nAmount held on your card: ${rec.amount_paid}\n\n` +
    `What happens next: your card has been authorised (held), not charged. We check your dates and confirm by email or WhatsApp, usually within the hour. ` +
    `The payment is only taken once we confirm. If we cannot confirm your dates, the hold is released and you are not charged.\n\n` +
    `Cancellation: full refund if you cancel at least 45 days before check-in; no refund for later cancellations.\n\n` +
    `Questions? Reply to this email, or WhatsApp +44 7848 108122.\n\nDarko\nYour London Stay · yourlondonstay.com`;
  const e = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(to)}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", origin, referer: `${origin}/` },
    body: JSON.stringify({
      _subject: `New booking ${rec.reference} · ${rec.check_in} to ${rec.check_out} · ${rec.amount_paid}${rec.discount_code ? " · code " + rec.discount_code : ""}`,
      _template: "table",
      _captcha: "false",
      ...(rec.guest_email ? { email: rec.guest_email, _replyto: rec.guest_email, _autoresponse: guestText } : {}),
      ...rec,
    }),
  }).catch((err) => ({ ok: false, status: String(err) }));
  if (!e.ok) console.error("Booking email failed", e.status);

  return json(summary(rec));
};

export const config = { path: "/api/booking" };
