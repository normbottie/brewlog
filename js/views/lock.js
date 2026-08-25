/* Sign-in gate — the app requires an account.
   Two ways in: tap the emailed link (works when the email opens in the same
   browser), or type the code from that same email (works everywhere,
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
        <label for="l-addr">Email</label>
        <input id="l-addr" data-email type="text" inputmode="email" autocomplete="off"
               autocapitalize="none" autocorrect="off" spellcheck="false" name="bl-addr"
               readonly value="${esc(savedEmail)}">
      </div>
      <button class="btn-primary btn-block" data-send>Email me a sign-in code</button>
      <div class="hint" data-status style="margin-top:10px"></div>

      <div style="border-top:1px solid var(--glass-brd);margin:18px 0 14px"></div>

      <div class="field">
        <label for="l-code">Enter the code from the email</label>
        <input id="l-code" data-code inputmode="numeric" autocomplete="one-time-code"
               maxlength="10" placeholder="••••••••"
               style="letter-spacing:.4em;text-align:center;font-size:20px;font-variant-numeric:tabular-nums">
      </div>
      <button class="btn-block" data-verify>Verify code</button>
      <div class="hint" style="margin-top:10px">
        The email has a sign-in link too. Use the code if you added Brewlog to your
        Home Screen — iPhone opens that link in Safari, so it would sign you in
        there rather than here.
      </div>
    </div>

    <div class="hint" style="text-align:center;margin-top:14px">
      First time? Signing in creates your account automatically.
    </div>
  </div>`);

  const emailEl = view.querySelector('[data-email]');
  const codeEl = view.querySelector('[data-code]');
  const status = view.querySelector('[data-status]');

  /* The field starts readonly so Safari has nothing to attach its contact
     autofill to on load; the first real touch unlocks it. pointerdown fires
     before focus, so the keyboard still opens normally. */
  const unlock = () => { emailEl.removeAttribute('readonly'); };
  emailEl.addEventListener('pointerdown', unlock);
  emailEl.addEventListener('focus', () => {
    if (emailEl.hasAttribute('readonly')) {
      unlock();
      emailEl.blur();
      setTimeout(() => emailEl.focus(), 0);
    }
  });

  /* iOS autofill or a paste drops the whole code in at once — verify it
     without a second tap. Typing digit by digit still uses the button. */
  let prevLen = 0;
  codeEl.addEventListener('input', () => {
    const len = codeEl.value.replace(/\D/g, '').length;
    if (len >= 6 && len - prevLen >= 4) {
      view.querySelector('[data-verify]').click();
    }
    prevLen = len;
  });

  view.querySelector('[data-send]').onclick = async (e) => {
    if (!isConfigured()) { status.textContent = 'The app is missing its project configuration.'; return; }
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Sending…';
    try {
      const sent = await signIn(emailEl.value);
      try { localStorage.setItem(LS_EMAIL, sent); } catch {}
      status.textContent = `Sent to ${sent}. Type the code below, or tap the link if the email opens here.`;
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
