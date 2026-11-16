// Google Drive backup (BG-08). The app asks only for the "drive.file" scope:
// it can see and change the files it created itself, nothing else in the Drive.
// The Client ID is public by design; there is no client secret in a browser app.
export const CLIENT_ID = '698092552577-j7i6rsmprqp6aqam29gomo0flrn2v71r.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FILE_NAME = 'budget-backup.json';
const ID_KEY = 'budget-drive-file-id';
const API = 'https://www.googleapis.com';

let gsi = null, token = null, tokenExp = 0, client = null;

export function loadGsi() {
  if (gsi) return gsi;
  gsi = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gsi = null; reject(new Error('Could not reach Google. Check the connection.')); };
    document.head.appendChild(s);
  });
  return gsi;
}
export const hasToken = () => !!token && Date.now() < tokenExp - 60000;

function getToken() {
  if (hasToken()) return Promise.resolve(token);
  return loadGsi().then(() => new Promise((resolve, reject) => {
    client = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID, scope: SCOPE,
      callback: (r) => {
        if (r.error || !r.access_token) return reject(new Error(r.error_description || r.error || 'Google sign-in did not complete.'));
        token = r.access_token; tokenExp = Date.now() + (Number(r.expires_in) || 3600) * 1000; resolve(token);
      },
      error_callback: (e) => reject(new Error(e?.type === 'popup_closed' ? 'The Google window was closed.' : e?.type === 'popup_failed_to_open' ? 'The browser blocked the Google window. Allow pop-ups for this app.' : 'Google sign-in did not complete.')),
    });
    client.requestAccessToken({ prompt: '' });
  }));
}

async function call(url, opts = {}) {
  const t = await getToken();
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${t}` } });
  if (res.status === 401) { token = null; throw new Error('Google sign-in expired. Tap again.'); }
  return res;
}

async function findFile() {
  const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
  const res = await call(`${API}/drive/v3/files?q=${q}&orderBy=modifiedTime%20desc&fields=files(id,name,modifiedTime)&spaces=drive`);
  if (!res.ok) throw new Error(`Google Drive answered ${res.status}.`);
  const files = (await res.json()).files || [];
  return files[0] || null;
}

export async function backupToDrive(payload) {
  const body = JSON.stringify(payload);
  let id = null;
  try { id = localStorage.getItem(ID_KEY); } catch { /* ignore */ }
  if (id) {
    const res = await call(`${API}/upload/drive/v3/files/${id}?uploadType=media&fields=id,modifiedTime`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
    if (res.ok) return res.json();
    if (res.status !== 404) throw new Error(`Google Drive answered ${res.status}.`);
    id = null; // the file was removed from Drive: make a new one
  }
  const existing = await findFile();
  if (existing) {
    const res = await call(`${API}/upload/drive/v3/files/${existing.id}?uploadType=media&fields=id,modifiedTime`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
    if (!res.ok) throw new Error(`Google Drive answered ${res.status}.`);
    try { localStorage.setItem(ID_KEY, existing.id); } catch { /* ignore */ }
    return res.json();
  }
  const boundary = 'budget' + Math.random().toString(36).slice(2);
  const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: FILE_NAME, mimeType: 'application/json' })}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const res = await call(`${API}/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart });
  if (!res.ok) throw new Error(`Google Drive answered ${res.status}.`);
  const out = await res.json();
  try { localStorage.setItem(ID_KEY, out.id); } catch { /* ignore */ }
  return out;
}

export async function restoreFromDrive() {
  const f = await findFile();
  if (!f) throw new Error('No backup from this app was found in your Google Drive.');
  const res = await call(`${API}/drive/v3/files/${f.id}?alt=media`);
  if (!res.ok) throw new Error(`Google Drive answered ${res.status}.`);
  return { data: await res.json(), modified: f.modifiedTime };
}
