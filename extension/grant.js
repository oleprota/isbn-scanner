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
  text.textContent = t.ask(origins[0].slice(4, -2));
  button.textContent = t.allow;
  button.onclick = async () => {
    const granted = await chrome.permissions.request({ origins }).catch(() => false);
    text.textContent = granted ? t.done : t.denied;
    button.hidden = true;
  };
}
