#!/usr/bin/env python3
"""Make an Instagram image (1080x1350 JPEG) for one Airbnb review.

Usage (repo root):  python3 scripts/review_post.py "<review name>" "<YYYY-MM-DD>"
The review must exist in data/airbnb-reviews.json.

Background: the next living-room / bedroom photo that has not been used yet
(rotation kept in data/instagram-review-posts.json). Output: social/<file>.jpg,
served publicly at https://yourlondonstay.com/social/<file>.jpg after a push.
Prints JSON: {"file", "url", "photo", "caption"}.
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "scripts" / "fonts"
LOG = ROOT / "data" / "instagram-review-posts.json"
OUT = ROOT / "social"
SITE = "https://yourlondonstay.com"
# Only living room and bedroom photos (Darko's rule).
PHOTOS = ["hero.webp", "bedroom.webp", "living-sofa.webp", "bedroom-detail.webp",
          "living-wide.webp", "bedroom-evening.webp", "living-tv.webp", "bedroom-desk.webp",
          "living-evening.webp", "bedroom-wardrobe.webp", "living-portrait.webp",
          "bedroom-hallway.webp", "living-media.webp", "living-door.webp"]
W, H = 1080, 1350
NAVY, CHAMPAGNE, WHITE = (20, 30, 52), (214, 190, 140), (255, 255, 255)
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December"]


def font(name, size):
    return ImageFont.truetype(str(FONTS / f"{name}.ttf"), size)


def renderable(text, f):
    try:
        return all(f.getmask(ch).getbbox() is not None or ch.isspace() for ch in text)
    except Exception:
        return False


def wrap(draw, text, f, width):
    lines, line = [], ""
    for word in text.split():
        test = (line + " " + word).strip()
        if draw.textlength(test, font=f) <= width:
            line = test
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def star(draw, cx, cy, r, fill):
    import math
    pts = []
    for i in range(10):
        a = math.pi / 2 + i * math.pi / 5
        rr = r if i % 2 == 0 else r * 0.45
        pts.append((cx + rr * math.cos(a), cy - rr * math.sin(a)))
    draw.polygon(pts, fill=fill)


def cover(img):
    s = max(W / img.width, H / img.height)
    img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    x, y = (img.width - W) // 2, (img.height - H) // 2
    return img.crop((x, y, x + W, y + H))


def next_photo(log):
    used = [p["photo"] for p in log["posts"]]
    unused = [p for p in PHOTOS if p not in used]
    if unused:
        return unused[0]
    # all used once: start the cycle again, least recently used first
    return min(PHOTOS, key=lambda p: max(i for i, u in enumerate(used) if u == p))


def main():
    name, rdate = sys.argv[1], sys.argv[2]
    data = json.loads((ROOT / "data" / "airbnb-reviews.json").read_text(encoding="utf-8"))
    review = next(r for r in data["reviews"] if r["name"] == name and r["date"] == rdate)
    log = json.loads(LOG.read_text(encoding="utf-8")) if LOG.exists() else {"posts": []}
    if any(p["name"] == name and p["date"] == rdate for p in log["posts"]):
        sys.exit("ERROR: this review already has an Instagram post")
    photo = next_photo(log)

    img = cover(Image.open(ROOT / "img" / photo).convert("RGB"))
    # navy gradient from the middle down, for text contrast
    grad = Image.new("L", (1, H))
    for y in range(H):
        grad.putpixel((0, y), int(max(0, min(238, (y - H * 0.18) / (H * 0.30) * 238))))
    shade = Image.new("RGB", (W, H), NAVY)
    img = Image.composite(shade, img, grad.resize((W, H)))
    top = Image.new("L", (1, 220))
    for y in range(220):
        top.putpixel((0, y), int(150 * (1 - y / 220)))
    img.paste(shade.crop((0, 0, W, 220)), (0, 0), top.resize((W, 220)))
    base = img
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    m = 80
    d.text((m, 70), "YOUR LONDON STAY", font=font("jost-latin-500-normal", 30), fill=WHITE,
           spacing=0)
    d.text((m, 112), "Hammersmith · West London", font=font("jost-latin-400-normal", 24),
           fill=CHAMPAGNE)

    # quote, auto-size so it fits
    text = "“" + review["text"] + "”"
    for size in (54, 50, 46, 42, 38, 35, 32):
        qf = font("playfair-display-latin-500-italic", size)
        lines = wrap(d, text, qf, W - 2 * m)
        lh = int(size * 1.32)
        if len(lines) * lh <= 520:
            break
    block_h = len(lines) * lh
    name_f = font("jost-latin-500-normal", 30)
    meta_f = font("jost-latin-400-normal", 26)
    title_f = font("playfair-display-latin-500-normal", 44)

    y_bottom = H - 150
    y_q = y_bottom - 70 - block_h
    y_stars = y_q - 70
    y_title = y_stars - 80

    d.text((m, y_title), "What our guests say", font=title_f, fill=WHITE)
    for i in range(5):
        star(d, m + 18 + i * 44, y_stars + 18, 17, CHAMPAGNE if i < review["stars"] else (90, 100, 120))
    for i, line in enumerate(lines):
        d.text((m, y_q + i * lh), line, font=qf, fill=WHITE)

    who = review["name"] if renderable(review["name"], name_f) else "Airbnb guest"
    y, mo = int(rdate[:4]), int(rdate[5:7])
    d.text((m, y_bottom - 40), f"— {who}", font=name_f, fill=CHAMPAGNE)
    d.text((m + d.textlength(f"— {who}", font=name_f) + 18, y_bottom - 37),
           f"{MONTHS[mo - 1]} {y} · Airbnb" + (" · translated" if review.get("translated") else ""),
           font=meta_f, fill=(205, 210, 222))
    d.line((m, H - 95, W - m, H - 95), fill=(255, 255, 255, 60), width=1)
    d.text((m, H - 78), "yourlondonstay.com", font=meta_f, fill=WHITE)
    rating = f"{data['rating']} · {data['count']} reviews"
    d.text((W - m - d.textlength(rating, font=meta_f), H - 78), rating, font=meta_f, fill=CHAMPAGNE)

    alpha = img.split()[3]
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shadow.putalpha(alpha.point(lambda a: int(a * 0.7)).filter(ImageFilter.GaussianBlur(6)))
    out = base.convert("RGBA")
    out.alpha_composite(shadow, (2, 3))
    out.alpha_composite(img)
    img = out.convert("RGB")

    slug = re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()).strip("-") or "guest"
    OUT.mkdir(exist_ok=True)
    fname = f"review-{rdate}-{slug}.jpg"
    img.save(OUT / fname, "JPEG", quality=90, optimize=True)

    stars_txt = "★" * review["stars"]
    caption = (f"{stars_txt} “{review['text']}”\n— {review['name']}, {MONTHS[mo - 1]} {y}"
               + (" (translated by Airbnb)" if review.get("translated") else "") +
               f"\n\nThank you, {review['name']}! 🙏 Our guests rate us {data['rating']} from {data['count']} reviews."
               "\n\nA bright one-bedroom apartment in Hammersmith, 10 minutes from Barons Court Tube "
               "and the Piccadilly line direct to Heathrow. More at yourlondonstay.com (link in bio)."
               "\n\n#YourLondonStay #LondonStay #Hammersmith #WestLondon #LondonApartment "
               "#GuestReview #VisitLondon #LondonTravel #BaronsCourt #LondonHoliday")
    log["posts"].append({"name": name, "date": rdate, "photo": photo, "file": fname, "status": "made"})
    LOG.write_text(json.dumps(log, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"file": f"social/{fname}", "url": f"{SITE}/social/{fname}",
                      "photo": photo, "caption": caption}, ensure_ascii=False))


if __name__ == "__main__":
    main()
