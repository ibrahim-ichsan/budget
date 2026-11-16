// App lock (Q-06): asks the device for a fingerprint or screen lock when the app opens.
// This is a screen gate using the platform authenticator. It does not encrypt stored data.
const KEY = 'budget-lock-cred';
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

export const lockSupported = () => typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials;
export const lockEnabled = () => { try { return !!localStorage.getItem(KEY); } catch { return false; } };
export const disableLock = () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } };

export async function enableLock() {
  if (!lockSupported()) throw new Error('not supported on this browser');
  const ok = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  if (!ok) throw new Error('this device has no fingerprint or screen lock set up');
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: rand(32),
      rp: { name: 'Budget' },
      user: { id: rand(16), name: 'budget-owner', displayName: 'Budget owner' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000,
    },
  });
  localStorage.setItem(KEY, b64(cred.rawId));
}

export async function unlock() {
  const id = localStorage.getItem(KEY);
  if (!id) return true;
  await navigator.credentials.get({
    publicKey: { challenge: rand(32), allowCredentials: [{ type: 'public-key', id: unb64(id) }], userVerification: 'required', timeout: 60000 },
  });
  return true;
}
