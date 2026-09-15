/* Baked-in project configuration.
 *
 * Shipping the Supabase URL and the anon/publishable key in the source is
 * safe and is how every Supabase web app works: that key can only do what
 * row-level security allows, which for this schema is "nothing unless
 * signed in, and then only your own rows". The security lives in the
 * database policies, not in hiding this string.
 *
 * With both values filled in, a new device needs nothing but the sign-in
 * email. Values entered in Settings still override these.
 */
/* When true, Gemini calls go through the `gemini-proxy` Edge Function,
 * which holds the API key server-side — signed-in users can render and read
 * labels without any key on their device. A personal key entered in
 * Settings still overrides this. */
export const GEMINI_PROXY = true;

export const DEFAULT_SUPABASE = {
  url: 'https://uszcbsovcdzzfxqtzazb.supabase.co',
  key: 'sb_publishable_JHn6cJ4kGirP2eTWKaQRXg_Ft2FJpH4',
};

/* Stadia Maps' "Alidade Smooth Dark" vector style, used for both the cafes
 * map and a single cafe's mini-map. Genuinely sharp at any zoom and any
 * device pixel ratio, unlike a plain raster tile source (Esri's free Dark
 * Gray Canvas has no @2x tiles, which is why it looked soft on a retina
 * screen). Get a free key at https://client.stadiamaps.com — the
 * non-commercial tier costs nothing, it just needs the key's "Allowed
 * domains" set to normbottie.github.io (add localhost too for testing
 * locally). A blank/grey map where the pins still work means this key is
 * missing, wrong, or the domain restriction doesn't match. */
export const STADIA_API_KEY = '09890d52-b5b0-44d5-8d09-9f43ce2d8321';
