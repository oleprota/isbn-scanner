// Settings: the master switch (chrome.storage.sync) and the list of opted-in sites (= the granted site permissions).
// background.js watches both and re-registers the auto-start script.
import { options as t } from './texts.js';
import { hostPatterns, sitesFromOrigins } from './sites.js';

const $ = (id) => document.getElementById(id);
document.title = t.title;
$('masterText').textContent = t.master;
$('sitesTitle').textContent = t.sites;
$('empty').textContent = t.empty;

const master = $('master');
chrome.storage.sync.get({ autoMode: true }).then(({ autoMode }) => { master.checked = autoMode; });
master.onchange = () => chrome.storage.sync.set({ autoMode: master.checked });

async function showSites() {
  const { origins } = await chrome.permissions.getAll();
  const sites = sitesFromOrigins(origins);
  $('empty').hidden = sites.length > 0;
  $('sites').replaceChildren(...sites.map((site) => {
    const li = document.createElement('li');
    const button = Object.assign(document.createElement('button'), { textContent: t.remove });
    button.onclick = () => chrome.permissions.remove({ origins: hostPatterns(site) });
    li.append(site, button);
    return li;
  }));
}
showSites();
chrome.permissions.onAdded.addListener(showSites);
chrome.permissions.onRemoved.addListener(showSites);
