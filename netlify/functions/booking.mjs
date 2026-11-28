// Called by the website when a guest returns from Stripe after paying.
// Checks the Checkout Session with Stripe and, once per booking, records it as a
// Netlify Forms submission ("booking"), so Netlify emails the owner a booking notice.
import { getStore } from "@netlify/blobs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async (req) => {
  const id = new URL(req.url).searchParams.get("session_id") || "";
  if (!/^cs_(live|test)_[A-Za-z0-9]{10,200}$/.test(id)) return json({ ok: false }, 400);
  const secret = (process.env.STRIPE_SECRET_KEY || "").replace(/\s+/g, "");
  if (!secret) return json({ ok: false }, 503);

  const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${id}`, { headers: { authorization: `Bearer ${secret}` } });
  const s = await r.json().catch(() => ({}));
  if (!r.ok) { console.error("Stripe session read failed", r.status, s && s.error && s.error.message); return json({ ok: false }, 502); }
  if (s.status !== "complete") return json({ ok: false, status: s.status }, 409);

  const store = getStore("bookings");
  if (await store.get(id)) return json({ ok: true, already: true });

  const m = s.metadata || {};
  const c = s.customer_details || {};
  const amount = ((s.amount_total || 0) / 100).toFixed(2);
  const piId = typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent && s.payment_intent.id) || "";
  const rec = {
    "form-name": "booking",
    check_in: m.check_in || "",
    check_out: m.check_out || "",
    guests: m.guests || "",
    amount_paid: `£${amount}`,
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
  const f = await fetch(`${origin}/`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(rec).toString() });
  if (!f.ok) console.error("Booking form submission failed", f.status);

  // Email to the owner through FormSubmit (free, no account). The very first email asks to activate once.
  const to = process.env.BOOKING_EMAIL || "4yourlondonstay@gmail.com";
  const { "form-name": _f, ...fields } = rec;
  const e = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(to)}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", origin, referer: `${origin}/` },
    body: JSON.stringify({
      _subject: `New booking ${rec.check_in} to ${rec.check_out} · ${rec.amount_paid}${rec.discount_code ? " · code " + rec.discount_code : ""}`,
      _template: "table",
      _captcha: "false",
      ...fields,
    }),
  }).catch((err) => ({ ok: false, status: String(err) }));
  if (!e.ok) console.error("Booking email failed", e.status);
  return json({ ok: true });
};

export const config = { path: "/api/booking" };
