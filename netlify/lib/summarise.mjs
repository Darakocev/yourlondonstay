// Turns raw analytics events into the owner's report:
// traffic, countries, sources, clicks, booking funnel and why visitors did not book.

export const REASONS = {
  bounce: "Left within 10 seconds without doing anything",
  never_reached_booking: "Never scrolled to the booking calendar",
  no_free_dates: "Calendar showed no free nights for the months they looked at",
  no_dates_picked: "Looked at the calendar but did not pick dates",
  checkin_only: "Picked a check-in date but no check-out",
  saw_price_left: "Saw the full price and left",
  went_airbnb: "Went to Airbnb instead (booking with commission)",
  lead_whatsapp_form: "Sent WhatsApp / enquiry form (lead to follow up)",
  payment_error: "Payment error on the website",
  abandoned_stripe: "Opened Stripe payment but did not finish",
};

const inc = (o, k, n = 1) => { if (k == null || k === "") k = "(unknown)"; o[k] = (o[k] || 0) + n; };
const top = (o, n = 15) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);

export function summarise(events) {
  events.sort((a, b) => (a.t < b.t ? -1 : 1));
  const S = new Map();
  for (const ev of events) {
    const id = ev.sid || ev.vid;
    let s = S.get(id);
    if (!s) {
      s = { id, vid: ev.vid, start: ev.t, end: ev.t, c: ev.c, cn: ev.cn, city: ev.city, dev: ev.dev, src: "(direct)", ev: new Set(), secs: new Set(), clicks: [], scroll: 0, engaged: 0, quote: null, errors: [], months: new Set() };
      S.set(id, s);
    }
    s.end = ev.t;
    s.ev.add(ev.e);
    const d = ev.d || {};
    if (ev.e === "pv") { s.src = d.src || (ev.ig ? "instagram" : "(direct)"); s.land = d.path; s.lang = d.lang; }
    if (ev.e === "sec") s.secs.add(d.id);
    if (ev.e === "scroll") s.scroll = Math.max(s.scroll, +d.p || 0);
    if (ev.e === "clk") s.clicks.push(d.l);
    if (ev.e === "leave") s.engaged = Math.max(s.engaged, +d.s || 0);
    if (ev.e === "quote" || ev.e === "cal_out") s.quote = { in: d.in, out: d.out, n: d.n, g: d.g, tot: +d.tot || 0 };
    if (ev.e === "cal_in" && d.in) s.months.add(String(d.in).slice(0, 7));
    if (ev.e === "cal_nav" && d.m) s.months.add(d.m);
    if (ev.e === "pay_err" || ev.e === "form_err") s.errors.push(d.msg || ev.e);
  }

  const sessions = [...S.values()];
  const visitors = new Set(sessions.map((s) => s.vid)).size;
  const byDay = {}, byCountry = {}, byCity = {}, bySource = {}, byDevice = {}, clicks = {}, sections = {}, reasons = {}, demand = {};
  const funnel = { visits: 0, saw_booking: 0, picked_checkin: 0, got_price: 0, took_action: 0, opened_payment: 0, booked: 0 };
  let lostValue = 0, bookedValue = 0, engagedSum = 0;
  const errors = [], recent = [];

  for (const s of sessions) {
    const has = (e) => s.ev.has(e);
    inc(byDay, s.start.slice(0, 10));
    inc(byCountry, s.cn || s.c);
    if (s.city) inc(byCity, `${s.city}, ${s.c}`);
    inc(bySource, s.src);
    inc(byDevice, s.dev);
    s.clicks.forEach((l) => inc(clicks, l));
    s.secs.forEach((x) => inc(sections, x));
    s.months.forEach((m) => inc(demand, m));
    engagedSum += s.engaged;

    const sawBook = s.secs.has("book") || has("cal_in") || has("cal_nav") || !!s.quote;
    const booked = has("booked");
    funnel.visits++;
    if (sawBook) funnel.saw_booking++;
    if (has("cal_in")) funnel.picked_checkin++;
    if (s.quote) funnel.got_price++;
    if (has("pay_click") || has("wa") || has("airbnb") || has("form_ok")) funnel.took_action++;
    if (has("pay_redirect")) funnel.opened_payment++;
    if (booked) { funnel.booked++; bookedValue += s.quote?.tot || 0; }

    let r = null;
    if (!booked) {
      if (has("pay_redirect")) r = "abandoned_stripe";
      else if (has("pay_err")) r = "payment_error";
      else if (has("airbnb")) r = "went_airbnb";
      else if (has("wa") || has("form_ok")) r = "lead_whatsapp_form";
      else if (s.quote) r = "saw_price_left";
      else if (has("cal_in")) r = "checkin_only";
      else if (has("cal_none")) r = "no_free_dates";
      else if (sawBook) r = "no_dates_picked";
      else if (s.engaged < 10 && s.ev.size <= 2) r = "bounce";
      else r = "never_reached_booking";
      inc(reasons, r);
      if (s.quote && r !== "lead_whatsapp_form") lostValue += s.quote.tot;
    }
    s.errors.forEach((m) => errors.push({ t: s.end, c: s.c, msg: m }));
    recent.push({ t: s.start, country: s.cn || s.c, city: s.city, dev: s.dev, src: s.src, secs: Math.round(s.engaged), scroll: s.scroll, quote: s.quote, outcome: booked ? "BOOKED" : REASONS[r], clicks: s.clicks.slice(0, 8) });
  }

  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  return {
    totals: {
      visits: sessions.length, visitors, booked: funnel.booked, conversion_pct: pct(funnel.booked, sessions.length),
      avg_engaged_seconds: sessions.length ? Math.round(engagedSum / sessions.length) : 0,
      booked_value_gbp: Math.round(bookedValue), lost_quoted_value_gbp: Math.round(lostValue),
      from_instagram: bySource.instagram || 0,
    },
    funnel, funnel_pct: Object.fromEntries(Object.entries(funnel).map(([k, v]) => [k, pct(v, funnel.visits)])),
    reasons: top(reasons, 20).map(([k, v]) => ({ key: k, label: REASONS[k], count: v, pct: pct(v, sessions.length) })),
    by_day: Object.entries(byDay).sort(), by_country: top(byCountry), by_city: top(byCity), by_source: top(bySource), by_device: top(byDevice),
    top_clicks: top(clicks, 25), sections_reached: top(sections, 20), demand_months: Object.entries(demand).sort(),
    errors: errors.slice(-30).reverse(), recent: recent.slice(-60).reverse(),
  };
}
