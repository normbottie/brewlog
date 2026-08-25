# Brewlog

A personal coffee tasting journal. Photograph a bag of beans, get a uniform
studio-style shot of it, rate how it tasted on a five-axis radar, and keep
track of the cafes you drink at.

Bags link to the cafe they came from, every roaster gets a page averaging
what you've had from them, and any bean can be turned into a share card
image.

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

## Accounts and sync (Supabase)

The app is local-first: everything is stored in IndexedDB on the device and
works with no account and no network. Signing in adds sync across devices and
off-device backup of the bag photos.

1. Create a project at supabase.com (free tier is plenty).
2. SQL Editor → paste `schema.sql` → Run. This creates the `beans` and `cafes`
   tables scoped to each account, the row-level security policies, and the
   `bag-images` storage bucket.
3. Settings → API → copy the **Project URL** and the **anon public** key.
4. Authentication → URL Configuration → add your app's address to **Redirect
   URLs**, e.g. `https://<you>.github.io/brewlog/`. Magic links will not come
   back to the app without this.
5. In the app: Settings → Sync → paste the URL and key → **Save & test**.
6. Settings → Account → enter your email → **Email me a link** → open the link
   on that device. You stay signed in afterwards; repeat once per device.

Sync is last-write-wins on `updated_at`, and pushes queue up while offline.

**Security model.** Sign-in is a passwordless magic link. Every row carries a
`user_id`, and the policies only ever match `auth.uid() = user_id`, so accounts
cannot see each other's logs and the anon key on its own grants nothing. Bag
images live at `bag-images/<user-id>/<bean-id>.jpg`; the bucket is public for
reads so a plain `<img>` tag works, which means someone who guessed a full URL
could view that one image. To close that off, make the bucket private and
switch `beanImageURL()` to signed URLs.

If you used the earlier shared-key schema, re-running `schema.sql` drops those
policies and adopts your existing rows into your account — sign in through the
app once first so the account exists.

---

## Bag photos

Two paths, both producing the same 1080×1350 4:5 frame so every card lines up.

**Photo (default, free, offline).** The photo itself, cover-cropped to the
shared frame. Nothing added or removed.

**AI studio (optional).** Settings → Bag photo rendering → paste a key from
Google (Gemini) or OpenAI. An **AI studio** option then appears when you add a
bag: the photo goes to the model, which re-shoots it as a three-quarter product
shot on the espresso backdrop, with the side gusset blanked to a flat colour.
Costs a few cents per image, billed to you.

The prompt is emphatic about reproducing the label exactly and inventing
nothing, but image models are unreliable with small text — check a render
against the bag before saving it.

**Reading the label.** With the same key, **Read the label** transcribes the
bag and fills in any fields you have left empty. It never overwrites what you
have typed, and is told to leave a field blank rather than guess.

The key is kept in this browser's local storage and sent only to the provider
you picked. A static site cannot hide a key, so anyone with access to the
device can read it — use a key scoped to image generation and rotate it if
the device is shared.

---

## Cafes

Leaflet plus OpenStreetMap tiles — free, no key, no billing account.

**Near me** finds cafes around you via the Overpass API, marking any you have
already rated; **This map area** does the same for wherever the map is centred,
which is the fallback when location permission is off. Or tap the map to drop a
draggable pin, or use **+** to search an address (geocoded via Nominatim).
Five-star rating, notes, and a link out to directions.

Coverage is community-sourced: thorough in cities, patchier than Google in
suburbs. Google Places would be free at this volume (10k map loads and 5k
searches a month) but needs a billing account and a referrer-locked key, which
is a poor fit for a public static site.

---

## Project layout

```
index.html          app shell
manifest.json       PWA manifest
sw.js               service worker (app shell + map tile cache)
schema.sql          Supabase tables, policies, storage bucket
css/styles.css      the whole theme
js/
  app.js            hash router + tab bar
  store.js          domain model, local-first store, sync engine
  idb.js            IndexedDB wrapper
  supabase.js       REST + Storage client
  imaging.js        framing, API renders, label transcription
  auth.js           Supabase magic-link auth
  places.js         nearby cafes via OpenStreetMap Overpass
  radar.js          tasting radar SVG
  card.js           the share card, drawn on a canvas
  ui.js             DOM helpers, sheets, stars, toasts
  seed.js           sample data
  views/            one module per screen
vendor/             Leaflet 1.9.4, vendored so the app works offline
test/               Playwright checks (views, edit flow, auth, imaging)
```

## Tests

```bash
python3 -m http.server 8899 &
node test/shots.mjs      # screenshots every view, reports console errors
node test/edit.mjs       # the edit-an-existing-bag image flow
node test/auth.mjs       # sign-in UI and magic-link callback handling
node test/imaging.mjs    # the local framing pipeline on synthetic bags
node test/links.mjs      # bean-cafe links, roaster pages, the share card
```

Output lands in `test/shots/`.
