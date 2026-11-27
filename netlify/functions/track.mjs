// Cookieless first-party visitor analytics for yourlondonstay.com.
// Stores one small JSON record per event in Netlify Blobs (store "analytics").
// No cookies, nothing stored on the visitor's device, no IP address stored:
// visitors are counted with a one-way hash of IP + browser + date that changes every day.
import { getStore } from "@netlify/blobs";

const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pingdom|preview|facebookexternalhit|whatsapp\/|curl|python|wget|monitor/i;
const ALLOWED = new Set([
  "pv", "sec", "scroll", "clk", "cal_in", "cal_out", "cal_nav", "cal_none", "quote",
  "pay_click", "pay_err", "pay_redirect", "booked", "pay_cancel",
  "wa", "airbnb", "form_ok", "form_err", "leave",
]);
const clip = (v, n = 120) => (v == null ? undefined : String(v).slice(0, n));

async function hash(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].slice(0, 8).map((x) => x.toString(16).padStart(2, "0")).join("");
}

function device(ua) {
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  if (/Mobi|Android|iPhone/i.test(ua)) return "mobile";
  return "desktop";
}

export default async (req, context) => {
  if (req.method !== "POST") return new Response("", { status: 405 });
  const ua = req.headers.get("user-agent") || "";
  if (BOT.test(ua)) return new Response(null, { status: 204 });

  let body;
  try { body = JSON.parse(await req.text()); } catch { return new Response("", { status: 400 }); }
  const list = Array.isArray(body) ? body.slice(0, 20) : [body];

  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const salt = process.env.ANALYTICS_SALT || "yls";
  const vid = await hash(`${salt}|${day}|${context.ip || ""}|${ua}`);
  const geo = context.geo || {};
  const store = getStore("analytics");

  await Promise.all(list.filter((e) => e && ALLOWED.has(e.e)).map((e) => {
    const rec = {
      t: now.toISOString(),
      e: e.e,
      sid: clip(e.sid, 16),
      vid,
      c: geo.country?.code || "??",
      cn: geo.country?.name,
      city: geo.city,
      dev: device(ua),
      ig: /Instagram/i.test(ua) || undefined,
      fb: /FBAN|FBAV/i.test(ua) || undefined,
      d: e.d && typeof e.d === "object"
        ? Object.fromEntries(Object.entries(e.d).slice(0, 12).map(([k, v]) => [clip(k, 20), typeof v === "number" ? v : clip(v)]))
        : undefined,
    };
    const k = `e/${day}/${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
    return store.setJSON(k, rec);
  }));
  return new Response(null, { status: 204 });
};

export const config = { path: "/api/t" };
