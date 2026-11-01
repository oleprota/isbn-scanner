// A "site" for auto-mode is a host without "www.", with its subdomains, over http and https.
// shortcut: no public-suffix list, so shop.example.co.uk opts in only that host; upgrade if people need the whole domain.
export function sitePatterns(url) {
  let host;
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') return null;
    host = hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  return hostPatterns(host);
}

export const hostPatterns = (host) => [`*://${host}/*`, `*://*.${host}/*`];

// Only hosts granted as both patterns of sitePatterns count; the install-time origin and stray patterns are ignored.
export function sitesFromOrigins(origins) {
  const set = new Set(origins);
  return origins
    .map((origin) => origin.match(/^\*:\/\/([^*/]+)\/\*$/)?.[1])
    .filter((host) => host && set.has(`*://*.${host}/*`))
    .sort();
}
