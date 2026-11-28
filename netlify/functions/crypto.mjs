// Crypto payment for direct bookings: 10% off the stay price.
// The guest sends crypto to the wallet in the Netlify settings, then uploads a screenshot of the transaction.
// The screenshot is kept in Netlify Blobs; the owner gets an email (via FormSubmit) with a private link to it.
//
// Netlify environment variables:
//   CRYPTO_ADDRESS   wallet address guests pay to (crypto option is hidden while this is empty)
//   CRYPTO_COIN      e.g. USDT, USDC, BTC, ETH   (default USDT)
//   CRYPTO_NETWORK   e.g. TRC20 (Tron), ERC20 (Ethereum), BEP20, Bitcoin   (default TRC20)
//   CRYPTO_DISCOUNT  percent off for crypto (default 10)
//   CRYPTO_ENABLED   set to "false" to hide crypto without removing the address
import { getStore } from "@netlify/blobs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { key, priceStay } from "../lib/pricing.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const conf = () => {
  const address = String(process.env.CRYPTO_ADDRESS || "").trim();
  return {
    enabled: process.env.CRYPTO_ENABLED !== "false" && /^[A-Za-z0-9:._-]{20,120}$/.test(address),
    address,
    coin: String(process.env.CRYPTO_COIN || "USDT").trim().toUpperCase().slice(0, 10),
    network: String(process.env.CRYPTO_NETWORK || "TRC20").trim().slice(0, 30),
    discount: Math.min(50, Math.max(0, Number(process.env.CRYPTO_DISCOUNT) || 10)),
  };
};

// Approximate coin amount from CoinGecko, cached for 10 minutes. The GBP price is what counts.
const GECKO = { USDT: "tether", USDC: "usd-coin", BTC: "bitcoin", ETH: "ethereum", SOL: "solana", LTC: "litecoin", TRX: "tron", BNB: "binancecoin" };
let rateCache = { coin: "", gbp: 0, at: 0 };
async function gbpRate(coin) {
  if (rateCache.coin === coin && Date.now() - rateCache.at < 6e5) return rateCache.gbp;
  const id = GECKO[coin]; if (!id) return 0;
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=gbp`, { signal: AbortSignal.timeout(2500) });
    const v = Number((await r.json())?.[id]?.gbp) || 0;
    if (v > 0) rateCache = { coin, gbp: v, at: Date.now() };
    return v;
  } catch { return 0; }
}
const coinAmount = (gbp, rate, coin) => {
  if (!rate) return "";
  const dp = ["BTC"].includes(coin) ? 6 : ["ETH", "BNB", "SOL", "LTC"].includes(coin) ? 5 : 2;
  return (Math.ceil((gbp / rate) * 10 ** dp) / 10 ** dp).toFixed(dp);
};
const quote = (c, d) => {
  const P = priceStay(d.checkIn, d.checkOut, d.guests);
  if (P.error) return P;
  const full = Math.round((P.sub - P.disc) * 100) / 100;
  const gbp = Math.round(full * (100 - c.discount)) / 100;
  return { ...P, full, gbp };
};
const clean = (v, max = 200) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
const IMG = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" };

export default async (req) => {
  const c = conf();
  const u = new URL(req.url);
  const proofs = () => getStore("crypto-proofs");

  if (req.method === "GET") {
    // Owner link from the email: /api/crypto?proof=<id>&k=<token>
    if (u.searchParams.has("proof")) {
      const id = u.searchParams.get("proof") || "", k = u.searchParams.get("k") || "";
      if (!/^[a-f0-9]{16}$/.test(id) || !/^[a-f0-9]{32}$/.test(k)) return new Response("Not found", { status: 404 });
      const got = await proofs().getWithMetadata(id, { type: "arrayBuffer" });
      const want = got?.metadata?.k || "";
      if (!got || want.length !== k.length || !timingSafeEqual(Buffer.from(want), Buffer.from(k))) return new Response("Not found", { status: 404 });
      return new Response(got.data, { headers: { "content-type": got.metadata.type || "image/jpeg", "cache-control": "private, no-store", "x-robots-tag": "noindex" } });
    }
    if (!c.enabled) return json({ enabled: false });
    const base = { enabled: true, address: c.address, coin: c.coin, network: c.network, discount: c.discount };
    if (!u.searchParams.has("checkIn")) return json(base);
    const q = quote(c, { checkIn: u.searchParams.get("checkIn"), checkOut: u.searchParams.get("checkOut"), guests: u.searchParams.get("guests") });
    if (q.error) return json({ ...base, error: q.error }, q.status);
    const rate = await gbpRate(c.coin);
    return json({ ...base, full: q.full.toFixed(2), gbp: q.gbp.toFixed(2), amount: coinAmount(q.gbp, rate, c.coin), nights: q.n });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!c.enabled) return json({ error: "Crypto payment is not available. Please pay by card or message us." }, 503);
  if (Number(req.headers.get("content-length") || 0) > 5.5e6) return json({ error: "The screenshot is too large. Please use a smaller image (under 5 MB)." }, 413);

  let f; try { f = await req.formData(); } catch { return json({ error: "Bad request" }, 400); }
  if (clean(f.get("_honey"))) return json({ ok: true, ref: "YLS-C" });
  const name = clean(f.get("name"), 80), email = clean(f.get("email"), 120), phone = clean(f.get("phone"), 40), txid = clean(f.get("txid"), 160);
  if (name.length < 2) return json({ error: "Please enter your full name." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ error: "Please enter a valid email address." }, 400);
  const file = f.get("screenshot");
  if (!file || typeof file.arrayBuffer !== "function" || !file.size) return json({ error: "Please attach a screenshot of your transaction." }, 400);
  const type = IMG[file.type] ? file.type : "";
  if (!type) return json({ error: "The screenshot must be a JPG, PNG, WEBP or HEIC image." }, 400);
  if (file.size > 5e6) return json({ error: "The screenshot is too large. Please use a smaller image (under 5 MB)." }, 413);

  const q = quote(c, { checkIn: f.get("checkIn"), checkOut: f.get("checkOut"), guests: f.get("guests") });
  if (q.error) return json({ error: q.error }, q.status);
  const rate = await gbpRate(c.coin);

  const id = randomBytes(8).toString("hex"), k = randomBytes(16).toString("hex");
  const ref = "YLS-C" + id.slice(-5).toUpperCase();
  const rec = {
    reference: ref, payment_method: `Crypto ${c.coin} (${c.network})`, payment_status: "UNVERIFIED: check the wallet before confirming",
    check_in: key(q.cin), check_out: key(q.cout), nights: String(q.n), guests: String(q.g),
    amount_due: `£${q.gbp.toFixed(2)} (${c.discount}% crypto discount on £${q.full.toFixed(2)})`,
    approx_coin_amount: rate ? `${coinAmount(q.gbp, rate, c.coin)} ${c.coin} at £${rate} per ${c.coin}` : "rate not available",
    wallet: c.address, transaction_id: txid || "not given",
    guest_name: name, guest_email: email, guest_phone: phone || "not given",
    created: new Date().toISOString(),
  };
  await proofs().set(id, await file.arrayBuffer(), { metadata: { k, type, ref, check_in: rec.check_in, check_out: rec.check_out, email, created: rec.created } });
  rec.screenshot = `${u.origin}/api/crypto?proof=${id}&k=${k}`;

  const fmt = (s) => new Date(s + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const guestText = `Hello ${name.split(" ")[0]},\n\nThank you for booking Your London Stay. We have received your crypto payment confirmation.\n\n` +
    `Reference: ${ref}\nCheck-in: ${fmt(rec.check_in)} (from 12:00)\nCheck-out: ${fmt(rec.check_out)} (by 11:00)\nGuests: ${rec.guests}\nAmount: ${rec.amount_due}\nPaid in: ${c.coin} on ${c.network}\n\n` +
    `We now check the payment on the blockchain and confirm your dates by email or WhatsApp, usually within a few hours. If we can't confirm the dates, we refund the full amount to the wallet it came from.\n\n` +
    `Questions? Reply to this email, or WhatsApp +44 7848 108122.\n\nDarko\nYour London Stay · yourlondonstay.com`;
  const notify = {
    to: process.env.BOOKING_EMAIL || "4yourlondonstay@gmail.com",
    data: {
      _subject: `CRYPTO booking ${ref} · ${rec.check_in} to ${rec.check_out} · £${q.gbp.toFixed(2)} · VERIFY PAYMENT`,
      _template: "table", _captcha: "false", email, _replyto: email, _autoresponse: guestText,
      ...rec,
    },
  };
  return json({ ok: true, ref, gbp: q.gbp.toFixed(2), check_in: rec.check_in, check_out: rec.check_out, guests: rec.guests, nights: rec.nights, email, notify });
};

export const config = { path: "/api/crypto" };
