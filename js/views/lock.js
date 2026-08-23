/* Sign-in gate — the app requires an account.
   Two ways in: tap the emailed link (works when the email opens in the same
   browser), or type the 6-digit code from that same email (works everywhere,
   and is the only way in from the installed app on iOS, where mail links
   always open Safari instead). */

import { h, esc } from '../ui.js';
import { signIn, verifyCode } from '../auth.js';
import { isConfigured } from '../supabase.js';

const LS_EMAIL = 'brewlog.auth.email';

export function render(root) {
  let savedEmail = '';
  try { savedEmail = localStorage.getItem(LS_EMAIL) || ''; } catch {}

  const view = h(`<div class="view" style="display:flex;flex-direction:column;justify-content:center;min-height:82vh;padding-bottom:30px">
    <div style="text-align:center;margin-bottom:24px">
      <img src="./icons/icon-180.png" alt="" style="width:86px;height:86px;border-radius:24px;box-shadow:var(--shadow-lg)">
      <h1 style="font-size:30px;font-weight:680;letter-spacing:-.024em;margin:16px 0 6px;
          background:linear-gradient(97deg,var(--tan-bright),#F3E4CE 46%,var(--tan));
          -webkit-background-clip:text;background-clip:text;color:transparent">Brewlog</h1>
      <div class="hint" style="margin:0">Sign in to open your coffee log.</div>
    </div>

    <div class="glass card-pad">
      <div class="field">
        <label for="l-email">Email</label>
        <input id="l-email" data-email type="email" inputmode="email" autocomplete="email"
               placeholder="you@example.com" value="${esc(savedEmail)}">
      </div>
      <button class="btn-primary btn-block" data-send>Email me a sign-in code</button>
      <div class="hint" data-status style="margin-top:10px"></div>

      <div style="border-top:1px solid var(--glass-brd);margin:18px 0 14px"></div>

      <div class="field">
        <label for="l-code">Enter the 6-digit code from the email</label>
        <input id="l-code" data-code inputmode="numeric" autocomplete="one-time-code"
               maxlength="6" placeholder="••••••"
               style="letter-spacing:.4em;text-align:center;font-size:20px;font-variant-numeric:tabular-nums">
      </div>
      <button class="btn-block" data-verify>Verify code</button>
      <div class="hint" style="margin-top:10px">
        The email also contains a tappable link — it works too, but on iPhone it opens
        in Safari, so from the installed app the code is the way in.
      </div>
    </div>

    <div class="hint" style="text-align:center;margin-top:14px">
      First time? Signing in creates your account automatically.
    </div>
  </div>`);

  const emailEl = view.querySelector('[data-email]');
  const codeEl = view.querySelector('[data-code]');
  const status = view.querySelector('[data-status]');

  view.querySelector('[data-send]').onclick = async (e) => {
    if (!isConfigured()) { status.textContent = 'The app is missing its project configuration.'; return; }
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Sending…';
    try {
      const sent = await signIn(emailEl.value);
      try { localStorage.setItem(LS_EMAIL, sent); } catch {}
      status.textContent = `Sent to ${sent}. Type the 6-digit code below, or tap the link if the email opens here.`;
      codeEl.focus();
    } catch (err) {
      status.textContent = /sign.?ups?.*(disabled|not allowed)/i.test(err.message || '')
        ? 'This log is invite-only — ask Norm to add your email, then try again.'
        : (err.message || 'Could not send the email');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Email me a sign-in code';
    }
  };

  view.querySelector('[data-verify]').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Checking…';
    try {
      await verifyCode(emailEl.value, codeEl.value);
      try { localStorage.setItem(LS_EMAIL, emailEl.value.trim()); } catch {}
      // onAuthChange re-routes into the app
    } catch (err) {
      status.textContent = err.message || 'That code did not work';
      btn.disabled = false;
      btn.textContent = 'Verify code';
      return;
    }
    btn.textContent = 'Signed in';
  };

  codeEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') view.querySelector('[data-verify]').click();
  });

  root.appendChild(view);
}
