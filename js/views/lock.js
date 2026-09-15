/* Sign-in gate — the app requires an account.
   Two ways in: tap the emailed link (works when the email opens in the same
   browser), or type the code from that same email (works everywhere,
   and is the only way in from the installed app on iOS, where mail links
   always open Safari instead). */

import { h, esc } from '../ui.js';
import { signIn, verifyCode } from '../auth.js';
import { isConfigured } from '../supabase.js';

const LS_EMAIL = 'brewlog.auth.email';

/* How many boxes to draw before any code is typed. Supabase's email OTP
   length is configurable per project (6-10); this project's is 8. CODE_MAX is
   the ceiling the input will accept, so a longer code is never silently cut. */
const CODE_LEN = 8;
const CODE_MAX = 10;

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
        <!-- type=email + autocomplete=username so Safari reads this card as a
             sign-in form. With autocomplete="off" on a text input it classified
             the whole thing as a contact form and kept offering "AutoFill
             Contact" over the code field below. -->
        <input id="l-addr" data-email type="email" inputmode="email" autocomplete="username"
               autocapitalize="none" autocorrect="off" spellcheck="false" name="email"
               readonly value="${esc(savedEmail)}">
      </div>
      <button class="btn-primary btn-block" data-send>Email me a sign-in code</button>
      <div class="hint" data-status style="margin-top:10px"></div>

      <div style="border-top:1px solid var(--glass-brd);margin:18px 0 14px"></div>

      <div class="field">
        <label for="l-code">Enter the code from the email</label>
        <!-- One real input, six drawn boxes. Six separate inputs would look the
             same and break the thing that matters: iOS drops an autofilled code
             in as a single value, and a paste has to land whole. The input sits
             transparent on top so it keeps focus, autofill and paste, while the
             boxes below just mirror what it holds. -->
        <div class="otp" data-otp>
          <div class="otp-boxes" aria-hidden="true"></div>
          <input id="l-code" data-code type="text" inputmode="numeric" pattern="[0-9]*"
                 autocomplete="one-time-code" name="one-time-code" maxlength="${CODE_MAX}"
                 autocapitalize="off" autocorrect="off" spellcheck="false"
                 data-1p-ignore data-lpignore="true"
                 aria-label="Sign-in code from your email">
        </div>
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

  /* Mirror the value into the boxes. The input itself is invisible, so this
     is the only thing that draws the code — including which box the caret is
     sitting in front of.

     The box count is NOT hard-coded. Supabase's OTP length is a per-project
     setting, and clamping the field to six silently truncated a longer code
     and made Verify fail with no explanation. So: draw CODE_LEN boxes, but if
     a longer code arrives, grow to fit it rather than cutting it off. */
  const boxRow = view.querySelector('.otp-boxes');
  function paintCode() {
    const digits = codeEl.value.replace(/\D/g, '').slice(0, CODE_MAX);
    if (codeEl.value !== digits) codeEl.value = digits;   // digits only
    const slots = Math.max(CODE_LEN, digits.length);
    if (boxRow.children.length !== slots) {
      boxRow.innerHTML = '<span></span>'.repeat(slots);
    }
    const focused = document.activeElement === codeEl;
    [...boxRow.children].forEach((box, i) => {
      box.textContent = digits[i] || '';
      box.classList.toggle('filled', Boolean(digits[i]));
      box.classList.toggle('caret', focused && i === Math.min(digits.length, slots - 1));
    });
  }
  codeEl.addEventListener('input', paintCode);
  codeEl.addEventListener('focus', paintCode);
  codeEl.addEventListener('blur', paintCode);
  /* The caret is always at the end — clicking into the middle of a code you
     are part-way through typing would otherwise strand it. */
  codeEl.addEventListener('click', () => {
    codeEl.setSelectionRange(codeEl.value.length, codeEl.value.length);
  });
  paintCode();

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
