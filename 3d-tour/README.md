# YourLondonStay – 3D (360°) Tour

Self-hosted tour, no subscription. Viewer: Pannellum 2.5.6 (MIT licence, included in `lib/`).

## Files
- `index.html` – the tour
- `lib/` – viewer (pannellum.js, pannellum.css)
- `img/` – panoramas (`p-*.jpg`) and detail photos for the "+" buttons

## Put it on the website
1. Upload the whole `3d-tour` folder to the site, e.g. `https://yourlondonstay.com/3d-tour/`
   (keep the folder structure: index.html, lib/, img/).
2. Open `https://yourlondonstay.com/3d-tour/` to check it works.
3. Embed it on any page (home page, apartment page):

```html
<iframe src="/3d-tour/" title="360° tour of YourLondonStay"
        style="width:100%;height:860px;border:0;border-radius:14px"
        loading="lazy" allowfullscreen></iframe>
```

- **WordPress:** upload the folder with FTP or the hosting File Manager into `public_html/3d-tour/`, then add a *Custom HTML* block with the iframe above.
- **Lodgify / Wix / other builders:** host the folder anywhere with HTTPS, then paste the iframe into an "HTML / Embed" block, with the full URL in `src`.

Note: opening `index.html` by double-click (file://) may show a black screen. It needs to run from a web server.

## Edit
Everything is in the `TOUR CONFIG` block at the top of the script in `index.html`:
- `go` = walk arrows, `info` = "+" buttons with photos
- `x` / `y` = position in the photo from 0 to 1
- "Check availability" button links to `/book` – change it to the real booking page.

Direct link to a room: `/3d-tour/#kitchen`, `#bedroom`, `#living`, `#bathroom`.
