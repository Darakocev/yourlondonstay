// Private analytics report for the owner: GET /api/stats?days=30
// Requires header "x-stats-key" equal to the STATS_KEY environment variable.
import { getStore } from "@netlify/blobs";
import { summarise } from "../lib/summarise.mjs";

const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async (req) => {
  const key = process.env.STATS_KEY;
  if (!key) return json({ error: "STATS_KEY is not set in Netlify." }, 503);
  if (req.headers.get("x-stats-key") !== key) return json({ error: "Wrong password." }, 401);

  const url = new URL(req.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "30", 10) || 30, 1), 90);
  const store = getStore("analytics");
  const keys = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    const { blobs } = await store.list({ prefix: `e/${day}/` });
    keys.push(...blobs.map((b) => b.key));
  }
  const events = [];
  for (let i = 0; i < keys.length; i += 50) {
    const part = await Promise.all(keys.slice(i, i + 50).map((k) => store.get(k, { type: "json" })));
    events.push(...part.filter(Boolean));
  }
  return json({ days, generated: new Date().toISOString(), ...summarise(events) });
};

export const config = { path: "/api/stats" };
