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
