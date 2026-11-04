// Developer mode lives one hour (a forgotten check would let a tab hammer our lookup service with uncached requests).
// Stored as an expiry time, checked on every read: no timers, so it survives the service worker sleeping.
export const DEV_MS = 3600 * 1000;

export async function readDev() {
  const saved = await chrome.storage.local.get({ developerUntil: 0, noCache: false });
  if (saved.developerUntil > Date.now()) return { developer: true, noCache: saved.noCache };
  if (saved.developerUntil || saved.noCache) await chrome.storage.local.remove(['developerUntil', 'noCache']);
  return { developer: false, noCache: false };
}
