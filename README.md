# Brewlog

A personal coffee tasting journal. Photograph a bag of beans, get a uniform
studio-style shot of it, rate how it tasted on a five-axis radar, and keep
track of the cafes you drink at.

Built as an installable PWA — no build step, no framework, no bundler. Push
the folder to GitHub Pages and add it to your iPhone home screen.

---

## Run it locally

Any static server works. From this folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Service workers and the camera need `localhost` or HTTPS — opening
`index.html` from the filesystem will not work.

## Deploy to GitHub Pages

1. Create a repo and push this folder to it.
2. Settings → Pages → Source: **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Open `https://<you>.github.io/<repo>/` on your iPhone in Safari.
4. Share → **Add to Home Screen**.

It then runs full screen with its own icon, and works offline.

The repo includes `.nojekyll` so GitHub serves the files as-is.

---

## Sync (Supabase)

The app is local-first: everything is stored in IndexedDB on the device and
works with no account and no network. Supabase is optional, and adds sync
across devices plus off-device backup of the bag photos.

1. Create a project at supabase.com (free tier is plenty).
2. SQL Editor → paste `schema.sql` → Run. This creates the `beans` and
   `cafes` tables and a public `bag-images` storage bucket.
3. Settings → API → copy the **Project URL** and the **anon public** key.
4. In the app: Settings → Sync → paste both → **Save & test**.

Sync is last-write-wins on `updated_at`, and pushes queue up while offline.

**About the security model.** `schema.sql` grants the anon key full read and
write on those two tables, which is what lets the app sync with no login
screen. That is a reasonable trade for a private personal app, but it does
mean anyone who gets the key can read and write your log. Do not paste the
key into a shared machine, and if you ever want to share the app itself,
switch to Supabase Auth and change the `using (true)` policies to
`using (auth.uid() = user_id)`.

---

## Bag photos

Two paths, both producing the same 1080×1350 4:5 frame so every card lines up.

**On-device (default, free, offline).** The photo is matted by flood-filling
inward from the frame edges, which finds the wall behind the bag. The bag is
cut out, scaled to a fixed position, and composited onto one of three shared
backdrops with a contact shadow and a soft reflection.

It works best when the bag is upright against a plain-ish wall with a bit of
separation. Busy backgrounds confuse it — the app always offers a **Plain**
variant (same framing, no cutout) as a fallback, and refuses the cutout
automatically if the mask looks wrong.

**API render (optional).** Settings → Bag photo rendering → paste a key from
Google (Gemini) or OpenAI. An **AI studio** option then appears when you add
a bag, which sends the photo to the model and asks for a real studio
re-render. Costs a few cents per image, billed to you.

The key is kept in this browser's local storage and sent only to the provider
you picked. A static site cannot hide a key, so anyone with access to the
device can read it — use a key scoped to image generation and rotate it if
the device is shared.

---

## Cafes

Leaflet plus OpenStreetMap tiles — free, no key, no billing account. Tap the
map to drop a pin, or use **+** and type an address (geocoded via Nominatim).
Five-star rating, notes, and a link out to directions.

---

## Project layout

```
index.html          shell, icon sprite
manifest.json       PWA manifest
sw.js               service worker (app shell + map tile cache)
schema.sql          Supabase tables, policies, storage bucket
css/styles.css      the whole theme
js/
  app.js            hash router + tab bar
  store.js          domain model, local-first store, sync engine
  idb.js            IndexedDB wrapper
  supabase.js       REST + Storage client
  imaging.js        matting, studio composite, API renders
  radar.js          tasting radar SVG
  ui.js             DOM helpers, sheets, stars, toasts
  seed.js           sample data
  views/            one module per screen
vendor/             Leaflet 1.9.4, vendored so the app works offline
test/               Playwright screenshot + imaging checks
```

## Tests

```bash
python3 -m http.server 8899 &
node test/shots.mjs      # screenshots every view, reports console errors
node test/imaging.mjs    # runs the cutout pipeline on three synthetic bags
```

Output lands in `test/shots/`.
