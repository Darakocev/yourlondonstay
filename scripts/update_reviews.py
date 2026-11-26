#!/usr/bin/env python3
"""Render data/airbnb-reviews.json into index.html.

Updates: the review cards, overall rating, review count, category bars,
the hero badge, the highlights line and the meta description.
Run from the repo root:  python3 scripts/update_reviews.py
Idempotent: running it twice gives the same file.
"""
import html
import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "airbnb-reviews.json"
PAGE = ROOT / "index.html"
START, END = "<!-- AIRBNB-REVIEWS:START -->", "<!-- AIRBNB-REVIEWS:END -->"
MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]


def month_label(iso):
    d = date.fromisoformat(iso)
    return f"{MONTHS[d.month - 1]} {d.year}"


def sub_once(pattern, repl, text, label):
    new, n = re.subn(pattern, repl, text, count=1, flags=re.S)
    if n != 1:
        sys.exit(f"ERROR: could not find {label} in index.html")
    return new


def main():
    data = json.loads(DATA.read_text(encoding="utf-8"))
    reviews = sorted(data["reviews"], key=lambda r: r["date"], reverse=True)
    rating, count = data["rating"], int(data["count"])
    if len(reviews) != count:
        sys.exit(f"ERROR: {len(reviews)} reviews in JSON but count says {count}. "
                 "Every Airbnb review must be listed.")
    visible = int(data.get("visible", 6))
    checked = month_label(data["checked"])
    s = PAGE.read_text(encoding="utf-8")

    # 1. Review cards
    cards = []
    for i, r in enumerate(reviews):
        cls = "rv" if i < visible else "rv rv--more"
        stars = "" if r["stars"] == 5 else f' · {r["stars"]}/5'
        tr = " · translated by Airbnb" if r.get("translated") else ""
        cards.append(
            f'      <figure class="{cls}"><blockquote>“{html.escape(r["text"], quote=False)}”</blockquote>'
            f'<figcaption><b>{html.escape(r["name"])}</b>{month_label(r["date"])} · Airbnb{stars}{tr}</figcaption></figure>')
    more = ""
    if count > visible:
        more = (f'\n    <p style="margin-top:20px"><button class="btn btn--ghost" type="button" id="rvMore" '
                f'aria-controls="rvAirbnb" aria-expanded="false" '
                f'onclick="var g=document.getElementById(\'rvAirbnb\');g.classList.remove(\'is-collapsed\');this.parentNode.remove();">'
                f'Show all {count} reviews</button></p>')
    block = (f'{START}\n    <div class="reviews is-collapsed" id="rvAirbnb">\n' + "\n".join(cards) +
             f'\n    </div>{more}\n    <p class="small muted" style="margin-top:20px">All {count} Airbnb reviews, newest first. '
             f'Reviews are lightly shortened. Last checked {checked}. '
             f'<a href="{data["listing_url"]}" target="_blank" rel="noopener">Read the full reviews on Airbnb</a></p>\n    {END}')
    if START in s:
        s = sub_once(re.escape(START) + r".*?" + re.escape(END), lambda m: block, s, "review markers")
    else:  # first run: replace the original hand-written block
        s = sub_once(r'<div class="reviews">\s*<figure.*?Read all reviews on Airbnb</a></p>',
                     lambda m: block, s, "original review block")

    # 2. CSS for the collapsed list (added once)
    css = ".reviews.is-collapsed .rv--more{display:none}"
    if css not in s:
        s = sub_once(r"(\.rv figcaption b\{[^}]*\})", lambda m: m.group(1) + "\n" + css, s, "review CSS")

    # 3. Rating numbers everywhere
    s = sub_once(r'(<div class="score"><b>)[\d.]+(</b>)', lambda m: m.group(1) + rating + m.group(2), s, "score")
    s = sub_once(r'\d+ verified Airbnb reviews, [A-Za-z]+ \d{4}',
                 f"{count} verified Airbnb reviews, {checked}", s, "score caption")
    s = sub_once(r'</span> [\d.]+ · \d+ reviews</dd>', f"</span> {rating} · {count} reviews</dd>", s, "hero badge")
    s = sub_once(r'<b>[\d.]+ guest rating</b>\d+ verified stays',
                 f"<b>{rating} guest rating</b>{count} verified stays", s, "highlight")
    s = sub_once(r'Rated [\d.]+ by guests\.', f"Rated {rating} by guests.", s, "meta description")

    # 4. Category bars
    for name, val in data["categories"].items():
        w = round(float(val) / 5 * 100)
        s = sub_once(r'<div class="bar" style="--w:\d+%"><span>' + re.escape(name) + r'</span><span>[\d.]+</span>',
                     f'<div class="bar" style="--w:{w}%"><span>{name}</span><span>{val}</span>', s, f"bar {name}")

    PAGE.write_text(s, encoding="utf-8")
    print(f"OK: {count} reviews, rating {rating}, checked {checked}")


if __name__ == "__main__":
    main()
