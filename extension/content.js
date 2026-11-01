// Injected by background.js on a toolbar click (after it set globalThis.isbnReaderTexts). Shows a frame with a spinner
// at once, reads the page, asks the service worker, then fills the frame with the card or a short "no books" line.
// The frame is a closed Shadow DOM (the page's CSS can't touch it). Everything the page or the service supplies
// goes in via textContent. Classic script (not a module): executeScript can't load modules.
(async () => {
  globalThis.isbnReaderClose?.(); // a second click replaces the first frame
  const t = globalThis.isbnReaderTexts;
  const box = (tag, text, className) => Object.assign(document.createElement(tag), { textContent: text ?? '', className: className ?? '' });

  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .frame { position: fixed; top: 16px; right: 16px; z-index: 2147483647; box-sizing: border-box; width: 300px; max-width: calc(100vw - 32px);
      padding: 12px; border-radius: 10px; font: 14px/1.4 system-ui, sans-serif; background: #fff; color: #1a1a1a; border: 1px solid #ccc; box-shadow: 0 4px 16px #0004; display: flex; gap: 10px; }
    @media (prefers-color-scheme: dark) { .frame { background: #1e1e1e; color: #eee; border-color: #444; } }
    img { width: 64px; height: 96px; object-fit: cover; border-radius: 4px; flex: none; }
    .body { min-width: 0; flex: 1; } .title { font-weight: 600; } .meta { opacity: .8; }
    .links { display: flex; gap: 12px; margin-top: 6px; } a { color: #1a56c8; }
    @media (prefers-color-scheme: dark) { a { color: #8ab4f8; } }
    button { position: absolute; top: 2px; right: 6px; border: 0; background: none; color: inherit; font-size: 20px; cursor: pointer; }
    .none { padding: 8px 12px; }
    .spinner { width: 20px; height: 20px; box-sizing: border-box; border: 3px solid #8885; border-top-color: #1a56c8; border-radius: 50%; animation: turn .8s linear infinite; }
    @keyframes turn { to { transform: rotate(360deg); } }`;
  const frame = box('div', null, 'frame');
  frame.role = 'dialog';
  const spinner = box('span', null, 'spinner');
  spinner.role = 'status';
  spinner.setAttribute('aria-label', t.loading);
  frame.append(spinner);
  root.append(style, frame);
  document.documentElement.append(host);

  const close = () => {
    host.remove();
    removeEventListener('keydown', onKey, true);
    globalThis.navigation?.removeEventListener('navigatesuccess', close);
  };
  const onKey = (event) => { if (event.key === 'Escape') close(); };
  addEventListener('keydown', onKey, true);
  globalThis.isbnReaderClose = close;
  globalThis.navigation?.addEventListener('navigatesuccess', close); // another page (also in-page navigation and Back): the card is no longer about this page

  const allText = () => {
    const body = document.body.cloneNode(true);
    body.querySelectorAll('script, style, noscript').forEach((n) => n.remove());
    return body.textContent;
  };
  const read = (selector, attr, doc) => [...doc.querySelectorAll(selector)].map((n) => (attr ? n.getAttribute(attr) : n.textContent) ?? '').filter(Boolean);
  // A single-page shop swaps the content without reloading, so the page's head and data scripts still describe the
  // book it was first loaded with. When the address is no longer the loaded one, the head data is read from a fresh
  // copy of this same page (one request to the site the user is on); if that fails, from the visible page only.
  const loaded = performance.getEntriesByType('navigation')[0]?.name ?? location.href;
  let data = document;
  if (loaded.split('#')[0] !== location.href.split('#')[0]) {
    data = await fetch(location.href, { credentials: 'same-origin' })
      .then((response) => response.text())
      .then((html) => new DOMParser().parseFromString(html, 'text/html'))
      .catch(() => new DOMParser().parseFromString('', 'text/html'));
  }
  const { card, problem } = (await chrome.runtime.sendMessage({
    jsonLd: read('script[type="application/ld+json"]', null, data),
    meta: [
      ...read('meta[property="books:isbn"], meta[property="og:isbn"], meta[name="isbn"], meta[itemprop="isbn"]', 'content', data),
      ...read('[itemprop="isbn"]:not(meta)', null, data),
    ],
    title: [document.title, ...read('meta[property="og:title"], meta[property="og:description"]', 'content', data)],
    // the page's text including hidden tabs (shops keep the specs tab, with its ISBN, hidden), then its JSON data
    text: [allText(), ...read('script[type="application/json"]', null, data)].join('\n').slice(0, 400000),
  }).catch(() => ({ problem: 'extension' }))) ?? { problem: 'extension' };
  if (!host.isConnected) return; // closed while waiting

  frame.replaceChildren();
  if (!card) {
    frame.classList.add('none');
    frame.append(box('span', t.problems[problem] ?? t.problems.error));
    setTimeout(close, 6000);
    return;
  }
  if (card.image) {
    const img = document.createElement('img');
    img.src = card.image; // already limited to https:// by cleanAnswer
    img.alt = '';
    frame.append(img);
  }
  const body = box('div', null, 'body');
  body.append(box('div', card.title, 'title'));
  if (card.author) body.append(box('div', card.author.name, 'meta'));
  if (card.rating) {
    const rating = box('div', card.rating.text, 'meta');
    rating.title = card.rating.title;
    body.append(rating);
  }
  const links = box('div', null, 'links');
  for (const { name, url, title } of card.links) {
    const link = box('a', name);
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = title;
    links.append(link);
  }
  body.append(links);
  const x = box('button', '×');
  x.setAttribute('aria-label', t.close);
  x.onclick = close;
  frame.append(body, x);
})();
