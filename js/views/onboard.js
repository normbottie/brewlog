/* First-run setup, shown once after an account's first sign-in.
   Two questions only: what to call you, and whether to share your log.
   Both are changeable later in Settings, which is what the footnote says
   so nobody feels they're committing to something. */

import { h, esc } from '../ui.js';
import { saveMyProfile, finishOnboarding, sharingMembers, myProfile, sync } from '../store.js';
import { currentUser, signOut } from '../auth.js';

/* Signed in, set up, but not yet let in. Deliberately a dead end rather
   than a half-working app: an unapproved account can read nothing but its
   own rows, so showing the tabs would only offer empty screens. */
export function renderPending(root) {
  const user = currentUser();
  const view = h(`<div class="view" style="display:flex;flex-direction:column;justify-content:center;min-height:78vh">
    <div style="text-align:center;margin-bottom:22px">
      <img src="./icons/icon-180.png" alt="" style="width:72px;height:72px;border-radius:21px;box-shadow:var(--shadow-lg)">
      <h1 style="font-size:24px;font-weight:680;letter-spacing:-.02em;margin:15px 0 6px">
        Waiting to be let in
      </h1>
      <div class="hint" style="margin:0">
        ${esc(myProfile()?.display_name || 'Your account')} is set up. An admin needs to
        approve it before your log opens.
      </div>
    </div>
    <div class="glass card-pad">
      <div class="hint" style="margin:0 0 14px">
        Signed in as ${esc(user?.email || '')}. Nothing is lost while you wait —
        check back once you have been approved.
      </div>
      <button class="btn-primary btn-block" data-recheck>Check again</button>
      <div class="hint" data-pendstatus style="margin-top:10px"></div>
      <div style="border-top:1px solid var(--glass-brd);margin:16px 0 13px"></div>
      <button class="btn-block" data-signout>Sign out</button>
    </div>
  </div>`);

  const status = view.querySelector('[data-pendstatus]');
  view.querySelector('[data-recheck]').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Checking…';
    status.textContent = '';
    try {
      await sync();
      // a successful approval re-routes through the data event; if we are
      // still here, nothing has changed yet
      status.textContent = 'Not yet — still waiting on an admin.';
    } catch {
      status.textContent = 'Could not reach the server. Try again in a moment.';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Check again';
    }
  };
  view.querySelector('[data-signout]').onclick = () => signOut();

  root.appendChild(view);
  return null;
}

/** "norm.bottie@gmail.com" -> "Norm Bottie" — a first guess, not a decision. */
function nameFromEmail(email) {
  const local = String(email || '').split('@')[0] || '';
  return local
    .replace(/[._-]+/g, ' ')
    .replace(/\d+/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function render(root) {
  const user = currentUser();
  const guess = nameFromEmail(user?.email);
  const others = sharingMembers();

  const view = h(`<div class="view" style="padding-bottom:34px">
    <div style="text-align:center;margin:26px 0 22px">
      <img src="./icons/icon-180.png" alt="" style="width:72px;height:72px;border-radius:21px;box-shadow:var(--shadow-lg)">
      <h1 style="font-size:26px;font-weight:680;letter-spacing:-.022em;margin:15px 0 6px">
        Welcome to Brewlog
      </h1>
      <div class="hint" style="margin:0">Two quick things, then you're in.</div>
    </div>

    <div class="glass card-pad">
      <div class="field">
        <label for="o-name">What should we call you?</label>
        <input id="o-name" data-name placeholder="Your name" value="${esc(guess)}"
               autocapitalize="words" autocorrect="off" spellcheck="false"
               enterkeyhint="done">
        <div class="hint">Shown on entries you share. Your email is never shown.</div>
      </div>

      <div style="border-top:1px solid var(--glass-brd);margin:18px 0 14px"></div>

      <label class="share-row">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:15px">Share my log</div>
          <div class="hint" style="margin:2px 0 0">
            Lets other members see — but never edit — your beans and cafés.
            ${others.length
              ? `Already sharing with you: ${esc(others.map(p => p.display_name || 'Member').join(', '))}.`
              : 'You can leave this off and turn it on any time.'}
          </div>
        </div>
        <input type="checkbox" data-share>
        <span class="switch"></span>
      </label>

      <button class="btn-primary btn-block" data-done style="margin-top:18px">Start logging</button>
      <div class="hint" data-status style="margin-top:10px"></div>
    </div>

    <div class="hint" style="text-align:center;margin-top:14px">
      Both of these live in Settings — change them whenever you like.
    </div>
  </div>`);

  const nameEl = view.querySelector('[data-name]');
  const shareEl = view.querySelector('[data-share]');
  const status = view.querySelector('[data-status]');
  const btn = view.querySelector('[data-done]');

  async function submit() {
    const name = nameEl.value.trim();
    if (!name) {
      status.textContent = 'Pick a name first — it can be anything.';
      nameEl.focus();
      return;
    }
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Setting up…';
    status.textContent = '';
    try {
      await saveMyProfile({ display_name: name, share_log: shareEl.checked });
      await finishOnboarding();
      /* replace, not push: Back should never return to setup */
      location.replace('#/beans');
      // the hash may already be #/beans, in which case nothing would route
      if (!/#\/beans/.test(location.hash)) location.hash = '#/beans';
      else document.dispatchEvent(new CustomEvent('brewlog:data'));
    } catch (err) {
      status.textContent = (err.message || 'Could not save that') +
        ' — check your connection and try again.';
      btn.disabled = false;
      btn.textContent = 'Start logging';
    }
  }

  btn.addEventListener('click', submit);
  nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  root.appendChild(view);
  setTimeout(() => { if (!nameEl.value) nameEl.focus(); }, 120);
  return null;
}
