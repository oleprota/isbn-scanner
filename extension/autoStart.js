// Registered by background.js for the sites the user opted in (and only while auto-mode is on). Waits for the page
// to settle, then asks the service worker to run the usual lookup silently. Classic script, no imports.
if (!globalThis.isbnReaderAutoStarted) { // the registered script and the one injected into open tabs must not both run
  globalThis.isbnReaderAutoStarted = true;
  let timer;
  const ask = () => { clearTimeout(timer); timer = setTimeout(() => chrome.runtime.sendMessage({ auto: true }).catch(() => {}), 1500); };
  ask();
  globalThis.navigation?.addEventListener('navigatesuccess', ask); // in-page navigation of a single-page shop
}
