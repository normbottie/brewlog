/* Settings — sync, image rendering, backup. */

import * as sb from '../supabase.js';
import { exportJSON, importJSON, sync, syncState, listBeans, listCafes } from '../store.js';
import {
  PROVIDERS, getImageAPIConfig, setImageAPIConfig, clearImageAPIConfig,
} from '../imaging.js';
import { h, esc, toast, confirmSheet } from '../ui.js';
import { signIn, signOut, currentUser, isSignedIn, redirectURL } from '../auth.js';
import { seedDemoData } from '../seed.js';

export async function render(root) {
  const cfg = sb.getConfig();
  const img = getImageAPIConfig();
  const user = currentUser();
  const beans = await listBeans();
  const cafes = await listCafes();

  const view = h(`<div>
    <div class="topbar"><div><h1>Settings</h1><div class="sub">Sync, rendering, backup</div></div></div>
    <div class="view">

      <h2 class="section">Account</h2>
      <div class="glass card-pad">
        ${isSignedIn() ? `
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
            <div class="avatar" style="width:42px;height:42px;border-radius:13px;display:grid;
                 place-items:center;font-weight:700;color:#1B1410;
                 background:linear-gradient(163deg,var(--tan-bright),#A98A62)">
              ${esc((user?.email || '?').charAt(0).toUpperCase())}
            </div>
            <div style="min-width:0">
              <div style="font-weight:600">Signed in</div>
              <div class="hint" style="margin:0;overflow:hidden;text-overflow:ellipsis">${esc(user?.email || '')}</div>
            </div>
          </div>
          <button class="btn-block" data-signout>Sign out</button>
          <div class="hint" style="margin-top:10px">
            Signing out leaves this device's data in place; it stops syncing until you sign back in.
          </div>
        ` : `
          <div class="hint" style="margin-bottom:13px">
            Sign in to sync your log across devices. No password — we email you a
            link that signs you in and keeps you signed in.
          </div>
          <div class="field">
            <label for="s-email">Email</label>
            <input id="s-email" data-email type="email" inputmode="email"
                   autocomplete="email" placeholder="you@example.com">
          </div>
          <button class="btn-primary btn-block" data-signin>Email me a link</button>
          <div class="hint" data-authstatus style="margin-top:10px"></div>
        `}
      </div>

      <h2 class="section">Sync</h2>
      <div class="glass card-pad">
        <div style="display:flex;align-items:center;gap:9px;margin-bottom:14px">
          <span class="sync-dot ${syncState.status === 'on' ? 'on' : syncState.status === 'err' ? 'err' : ''}" data-sync-dot></span>
          <span style="font-size:14px;color:var(--text-muted)" data-sync-msg>${esc(syncState.message)}</span>
        </div>
        <div class="field">
          <label for="s-url">Supabase project URL</label>
          <input id="s-url" data-url placeholder="https://xxxx.supabase.co" value="${esc(cfg?.url || '')}">
        </div>
        <div class="field">
          <label for="s-key">Anon (public) key</label>
          <input id="s-key" data-key type="password" placeholder="eyJhbGciOi…" value="${esc(cfg?.key || '')}">
        </div>
        <div class="hint" style="margin-bottom:13px">
          Stored on this device only. Run <code>schema.sql</code> in the Supabase SQL editor first.
          Then in Authentication → URL Configuration, add
          <code>${esc(redirectURL())}</code> to the redirect allow-list so magic links come back here.
        </div>
        <div style="display:flex;gap:9px">
          <button class="btn-primary" style="flex:1" data-save-sb>Save &amp; test</button>
          <button style="flex:0 0 auto" data-sync-now>Sync now</button>
        </div>
        ${cfg ? `<button class="btn-ghost btn-block btn-sm" data-clear-sb style="margin-top:9px">Disconnect</button>` : ''}
      </div>

      <h2 class="section">Bag photo rendering</h2>
      <div class="glass card-pad">
        <div class="hint" style="margin-bottom:13px">
          Without a key, the bag photo is used as-is. Add your own key to re-render it
          as a studio product shot (a few cents per photo, billed to you).
        </div>
        <div class="field">
          <label for="s-prov">Provider</label>
          <select id="s-prov" data-prov>
            ${Object.entries(PROVIDERS).map(([k, v]) =>
              `<option value="${k}" ${img?.provider === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="s-model">Model</label>
          <input id="s-model" data-model list="s-models"
                 placeholder="${esc(PROVIDERS[img?.provider || 'gemini'].defaultModel)}"
                 value="${esc(img?.model || '')}">
          <datalist id="s-models">
            ${(PROVIDERS[img?.provider || 'gemini'].models || []).map(m =>
              `<option value="${esc(m)}"></option>`).join('')}
          </datalist>
          <div class="hint">Gemini image models, cheapest first:
            <code>gemini-3.1-flash-lite-image</code> (~$0.03/image),
            <code>gemini-3.1-flash-image</code> (~$0.05),
            <code>gemini-3-pro-image</code> (~$0.13).</div>
        </div>
        <div class="field">
          <label for="s-imgkey">API key</label>
          <input id="s-imgkey" data-imgkey type="password" placeholder="Paste your key" value="${esc(img?.key || '')}">
        </div>
        <div class="hint" style="margin-bottom:13px">
          Kept in this browser's local storage and sent only to the provider you pick.
          Anyone with access to this device can read it — use a key scoped to image generation.
        </div>
        <div style="display:flex;gap:9px">
          <button class="btn-primary" style="flex:1" data-save-img>Save key</button>
          ${img ? `<button class="btn-danger" data-clear-img>Remove</button>` : ''}
        </div>
      </div>

      <h2 class="section">Your data</h2>
      <div class="glass card-pad">
        <div style="display:flex;gap:18px;margin-bottom:16px">
          <div><div class="k" style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--text-faint);font-weight:620">Beans</div>
            <div style="font-size:26px;font-weight:660">${beans.length}</div></div>
          <div><div class="k" style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--text-faint);font-weight:620">Cafes</div>
            <div style="font-size:26px;font-weight:660">${cafes.length}</div></div>
          <div style="flex:1"><div class="k" style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--text-faint);font-weight:620">Storage</div>
            <div style="font-size:26px;font-weight:660" data-usage>—</div></div>
        </div>
        <div class="stack">
          <button class="btn-block" data-export>Export backup (.json)</button>
          <button class="btn-block" data-import>Import backup</button>
          <button class="btn-block" data-seed>Load sample data</button>
        </div>
        <input type="file" accept="application/json,.json" hidden data-importfile>
      </div>

      <h2 class="section">Install</h2>
      <div class="glass card-pad">
        <div class="hint">
          On iPhone: open this page in Safari, tap Share, then <strong>Add to Home Screen</strong>.
          It then runs full-screen with its own icon and works offline.
        </div>
      </div>

      <div style="height:12px"></div>
      <div class="hint" style="text-align:center">Brewlog · local-first · v1.0</div>
    </div>
  </div>`);

  /* --- account --- */
  const authStatus = view.querySelector('[data-authstatus]');
  view.querySelector('[data-signin]')?.addEventListener('click', async (e) => {
    if (!sb.isConfigured()) {
      authStatus.textContent = 'Add your Supabase URL and key below first.';
      return;
    }
    const btn = e.currentTarget;
    const email = view.querySelector('[data-email]').value;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Sending…';
    try {
      const sent = await signIn(email);
      authStatus.textContent =
        `Link sent to ${sent}. Open it on this device — it expires in about an hour.`;
    } catch (err) {
      authStatus.textContent = err.message || 'Could not send the link';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Email me a link';
    }
  });

  view.querySelector('[data-signout]')?.addEventListener('click', async () => {
    if (await confirmSheet('Sign out?', 'Your beans and cafes stay on this device. Syncing stops until you sign back in.', 'Sign out')) {
      await signOut();
      toast('Signed out');
      location.reload();
    }
  });

  /* --- supabase --- */
  view.querySelector('[data-save-sb]').onclick = async (e) => {
    const btn = e.currentTarget;
    sb.setConfig(view.querySelector('[data-url]').value, view.querySelector('[data-key]').value);
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Testing…';
    try {
      await sb.testConnection();
      toast('Connected');
      await sync();
    } catch (err) {
      toast(err.message || 'Could not connect');
    } finally {
      btn.disabled = false; btn.textContent = 'Save & test';
    }
  };
  view.querySelector('[data-sync-now]').onclick = async () => {
    const ok = await sync();
    toast(ok ? 'Synced' : syncState.message);
  };
  view.querySelector('[data-clear-sb]')?.addEventListener('click', async () => {
    if (await confirmSheet('Disconnect Supabase?', 'Your data stays on this device. Sync stops until you reconnect.', 'Disconnect')) {
      sb.clearConfig();
      toast('Disconnected');
      location.reload();
    }
  });

  /* --- image api --- */
  view.querySelector('[data-save-img]').onclick = () => {
    const prov = view.querySelector('[data-prov]').value;
    const key = view.querySelector('[data-imgkey]').value;
    const model = view.querySelector('[data-model]').value || PROVIDERS[prov].defaultModel;
    if (!key.trim()) { toast('Paste a key first'); return; }
    setImageAPIConfig(prov, key, model);
    toast('Key saved — “AI studio” now appears when you add a bag');
  };
  view.querySelector('[data-clear-img]')?.addEventListener('click', () => {
    clearImageAPIConfig();
    toast('Key removed');
    location.reload();
  });
  view.querySelector('[data-prov]').addEventListener('change', (e) => {
    const p = PROVIDERS[e.target.value];
    view.querySelector('[data-model]').value = p.defaultModel;
    view.querySelector('#s-models').innerHTML =
      (p.models || []).map(m => `<option value="${esc(m)}"></option>`).join('');
  });

  /* --- data --- */
  view.querySelector('[data-export]').onclick = async () => {
    const json = await exportJSON();
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `brewlog-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  const importFile = view.querySelector('[data-importfile]');
  view.querySelector('[data-import]').onclick = () => importFile.click();
  importFile.onchange = async () => {
    const f = importFile.files?.[0];
    if (!f) return;
    try {
      const n = await importJSON(await f.text());
      toast(`Imported ${n} record${n === 1 ? '' : 's'}`);
      setTimeout(() => { location.hash = '#/beans'; }, 700);
    } catch (err) {
      toast(err.message || 'Import failed');
    }
  };
  view.querySelector('[data-seed]').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Building…';
    try {
      const n = await seedDemoData();
      toast(`Added ${n} sample bags and cafes`);
      setTimeout(() => { location.hash = '#/beans'; }, 700);
    } catch (err) {
      toast(err.message || 'Could not load samples');
      btn.disabled = false; btn.textContent = 'Load sample data';
    }
  };

  root.appendChild(view);

  if (navigator.storage?.estimate) {
    navigator.storage.estimate().then(({ usage }) => {
      const el = view.querySelector('[data-usage]');
      if (el && usage != null) el.textContent = `${(usage / 1048576).toFixed(1)} MB`;
    }).catch(() => {});
  }
}
