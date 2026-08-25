/* Supabase Auth — passwordless magic link, no SDK.

   Flow: signIn() asks Supabase to email a link pointing back at this app.
   Tapping it returns here with the session in the URL fragment, which
   captureSession() picks up on load. Tokens live in localStorage and are
   refreshed on demand. */

import { getConfig } from './supabase.js';

const LS_SESSION = 'brewlog.auth.session';

let session = null;      // { access_token, refresh_token, expires_at, user }
const listeners = new Set();

export function onAuthChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach(fn => { try { fn(session); } catch {} }); }

function load() {
  try {
    const raw = localStorage.getItem(LS_SESSION);
    session = raw ? JSON.parse(raw) : null;
  } catch { session = null; }
  return session;
}

function store(next) {
  session = next;
  try {
    if (next) localStorage.setItem(LS_SESSION, JSON.stringify(next));
    else localStorage.removeItem(LS_SESSION);
  } catch {}
  emit();
}

load();

export function currentUser() { return session?.user || null; }
/* A refresh token alone still counts: the access token may have expired
   while the app was closed, and the next request will renew it. Only a
   session the server has actually rejected is cleared, and that clears
   both. */
export function isSignedIn() { return !!(session?.access_token || session?.refresh_token); }
export function userId() { return session?.user?.id || null; }

/** The URL Supabase should send you back to — must be allowlisted there. */
export function redirectURL() {
  return location.origin + location.pathname;
}

/* ------------------------------------------------------------------ */

async function authFetch(path, options = {}) {
  const cfg = getConfig();
  if (!cfg) throw new Error('Add your Supabase URL and key first');

  let res;
  try {
    res = await fetch(`${cfg.url}/auth/v1/${path}`, {
      ...options,
      headers: {
        apikey: cfg.key,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
  } catch (err) {
    /* Couldn't reach the server at all. Flagged so callers can tell this
       apart from a real rejection — signing someone out because their
       train went into a tunnel is not acceptable. */
    const e = new Error('Could not reach the sign-in server');
    e.network = true;
    throw e;
  }

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const e = new Error(json?.msg || json?.error_description || json?.message || `Auth error ${res.status}`);
    e.status = res.status;
    e.code = json?.error_code || json?.error || '';
    /* A 5xx is the server having a bad day, not a verdict on our token. */
    if (res.status >= 500) e.network = true;
    throw e;
  }
  return json;
}

/** Email a magic link. */
export async function signIn(email) {
  const clean = String(email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error('That does not look like an email address');
  await authFetch('otp', {
    method: 'POST',
    body: JSON.stringify({
      email: clean,
      create_user: true,
      options: { email_redirect_to: redirectURL() },
    }),
  });
  return clean;
}

/** Sign in with the numeric code from the sign-in email.
 *  The magic link and the code come from the same email; the template must
 *  include {{ .Token }} for the code to appear. */
export async function verifyCode(email, code) {
  const clean = String(email || '').trim();
  const token = String(code || '').replace(/\D/g, '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error('Enter the email the code was sent to');
  if (token.length < 6 || token.length > 10) throw new Error('Enter the full code from the email');
  /* 'email' is the modern unified type; 'magiclink' and 'signup' are the
     legacy types for returning and first-time users respectively. */
  let payload = null;
  let firstErr = null;
  for (const type of ['email', 'magiclink', 'signup']) {
    try {
      payload = await authFetch('verify', {
        method: 'POST',
        body: JSON.stringify({ type, email: clean, token }),
      });
      break;
    } catch (err) {
      firstErr = firstErr || err;
    }
  }
  if (!payload) throw firstErr;
  const next = shape(payload);
  next.user = payload.user || await fetchUser(next.access_token);
  store(next);
  return next;
}

export async function signOut() {
  const token = session?.access_token;
  store(null);
  if (token) {
    try {
      await authFetch('logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: '{}',
      });
    } catch { /* local sign-out already happened */ }
  }
}

function shape(payload) {
  const expiresIn = Number(payload.expires_in || 3600);
  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_at: Date.now() + expiresIn * 1000,
    user: payload.user || null,
  };
}

async function fetchUser(accessToken) {
  try {
    return await authFetch('user', { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch { return null; }
}

/**
 * Pick the session out of the URL after following a magic link, then clean
 * the address bar. Returns true if a session was captured.
 *
 * The app is hash-routed, and Supabase returns tokens in that same fragment,
 * so this has to run before the router reads the hash.
 */
export async function captureSession() {
  const hash = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  const params = new URLSearchParams(hash.includes('=') ? hash : '');

  const errorDesc = params.get('error_description');
  if (errorDesc) {
    history.replaceState(null, '', location.pathname + '#/settings');
    throw new Error(decodeURIComponent(errorDesc.replace(/\+/g, ' ')));
  }

  const access = params.get('access_token');
  if (!access) {
    // PKCE-style callback: we have no verifier without the SDK
    if (new URLSearchParams(location.search).get('code')) {
      history.replaceState(null, '', location.pathname + '#/settings');
      throw new Error(
        'This project is using the PKCE flow. In Supabase → Authentication → ' +
        'URL Configuration, or in the email template, switch the magic link to the ' +
        'implicit flow so it returns tokens directly.'
      );
    }
    return false;
  }

  const next = shape({
    access_token: access,
    refresh_token: params.get('refresh_token'),
    expires_in: params.get('expires_in'),
  });
  next.user = await fetchUser(access);
  store(next);
  history.replaceState(null, '', location.pathname + '#/beans');
  return true;
}

/* Supabase rotates refresh tokens: each one may be redeemed once. A sync
   fires several authorised requests, and if two of them find the token
   expired at the same moment they both redeem the same refresh token —
   the second gets "Already Used" and the user is thrown out. So all
   callers share a single in-flight refresh. */
let refreshing = null;

/** The session another tab may have written since we last read it. */
function storedSession() {
  try {
    const raw = localStorage.getItem(LS_SESSION);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function redeem(token) {
  const payload = await authFetch('token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: token }),
  });
  const next = shape(payload);
  next.user = payload.user || session?.user || null;
  store(next);
  return next.access_token;
}

async function refreshSession() {
  const token = session?.refresh_token;
  if (!token) return null;
  try {
    return await redeem(token);
  } catch (err) {
    /* "Already used" usually means another tab rotated the token while we
       were holding the old one. If localStorage now has a different token,
       that is exactly what happened — take theirs and carry on. */
    const spent = /already used|invalid refresh token/i.test(err?.message || '');
    const latest = storedSession();
    if (spent && latest?.refresh_token && latest.refresh_token !== token) {
      session = latest;
      emit();
      if (latest.expires_at && Date.now() < latest.expires_at - 60000) return latest.access_token;
      return redeem(latest.refresh_token);
    }
    throw err;
  }
}

/** A valid access token, refreshing if it is close to expiry. */
export async function accessToken() {
  if (!session?.access_token && !session?.refresh_token) return null;

  const fresh = session.expires_at && Date.now() < session.expires_at - 60000;
  if (fresh && session.access_token) return session.access_token;
  if (!session.refresh_token) return session.access_token || null;

  if (!refreshing) {
    refreshing = refreshSession()
      .catch((err) => {
        /* Only a definitive answer from the server ends the session. A
           network failure or a 5xx leaves it alone so the next attempt can
           recover — the alternative is signing people out every time the
           connection wobbles, which is the bug this replaced. */
        if (!err?.network && (err?.status === 400 || err?.status === 401)) {
          store(null);
          return null;
        }
        return session?.access_token || null;
      })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

/* Another tab (or the installed app alongside the browser) may refresh
   first and rotate the token out from under us. Adopt whatever it wrote
   rather than trying to redeem a token that is now spent. */
window.addEventListener('storage', (e) => {
  if (e.key !== LS_SESSION) return;
  try {
    const next = e.newValue ? JSON.parse(e.newValue) : null;
    if (JSON.stringify(next) === JSON.stringify(session)) return;
    session = next;
    emit();
  } catch {}
});

/* Refresh a little before the app needs the token, so an expired session
   is renewed on resume rather than discovered mid-request. */
async function refreshIfStale() {
  if (document.visibilityState !== 'visible') return;
  if (!session?.refresh_token) return;
  const soon = !session.expires_at || Date.now() > session.expires_at - 300000;
  if (soon) { try { await accessToken(); } catch {} }
}
document.addEventListener('visibilitychange', refreshIfStale);
window.addEventListener('focus', refreshIfStale);
window.addEventListener('online', refreshIfStale);
