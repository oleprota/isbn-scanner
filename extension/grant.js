// Opened by background.js from the card's opt-in link: Chrome only lets an extension page ask for a site permission
// from a real click, and a click inside the page's frame (a content script) doesn't count.
import { grant as t } from './texts.js';
import { sitePatterns } from './sites.js';

const url = new URLSearchParams(location.search).get('url');
const origins = sitePatterns(url);
const text = document.getElementById('text');
const button = document.getElementById('allow');
if (!origins) {
  button.hidden = true;
} else {
  const host = origins[0].slice(4, -2);
  const favicon = new URL(chrome.runtime.getURL('/_favicon/')); // the browser's own copy of the site's icon, nothing is fetched by us
  favicon.search = new URLSearchParams({ pageUrl: `https://${host}/`, size: '32' });
  const site = document.createElement('span');
  site.className = 'site';
  const icon = document.createElement('img');
  icon.src = favicon.href;
  icon.alt = '';
  site.append(icon, host);
  text.append(`${t.ask} `, site, '?');
  button.textContent = t.allow;
  button.onclick = async () => {
    let granted = false;
    let failure = '';
    try { granted = await chrome.permissions.request({ origins }); } catch (error) { failure = ` (${error.message})`; } // Chrome refusing the request, vs the user declining
    text.textContent = granted ? t.done : t.denied + failure;
    button.textContent = t.close; // the same button closes the tab afterwards
    button.onclick = () => window.close();
  };
}
