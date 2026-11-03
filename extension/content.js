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
    .frame { --card: #fffdf8; --fg: #2a2823; --muted: #5e5a50; --link: #2f6f6b; --accent: #2f6f6b; --line: #e4dcc9; --error: #b32942; --star: #b7791f; --thin: #b34a00;
      position: fixed; top: 16px; right: 16px; z-index: 2147483647; box-sizing: border-box; width: 300px; max-width: calc(100vw - 32px);
      padding: 12px; border-radius: 10px; font: 14px/1.4 system-ui, sans-serif; background: var(--card); color: var(--fg); border: 1px solid var(--line); box-shadow: 0 4px 16px #0004; display: flex; gap: 10px; }
    @media (prefers-color-scheme: dark) { .frame { --card: #272726; --fg: #e8e8e6; --muted: #a8a8a4; --link: #3acb89; --accent: #3acb89; --line: #3a3a38; --error: #ff8a80; --star: #f2b84b; --thin: #f08a3c; } }
    img.cover { width: 64px; height: 96px; object-fit: cover; border-radius: 4px; flex: none; }
    .body { min-width: 0; flex: 1; } .title { font-weight: 600; } .meta { opacity: .8; }
    .links { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 20px; }
    a, .site { display: inline-flex; align-items: center; gap: 4px; color: var(--link); font: inherit; }
    a img { width: 16px; height: 16px; border-radius: 3px; }
    .site { margin-top: 6px; padding: 0; border: 0; background: none; text-decoration: underline; cursor: pointer; }
    button.close { position: absolute; top: 2px; right: 6px; border: 0; background: none; color: inherit; font-size: 20px; cursor: pointer; }
    .rating { display: flex; align-items: center; gap: 6px; margin-top: 4px; color: var(--accent); }
    .rating svg { flex: none; width: 18px; height: 18px; fill: var(--star); }
    .rating strong { font-size: 26px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
    .rating .count { align-self: flex-end; font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
    .rating .count.thin { color: var(--thin); }
    .rating .warning { align-self: flex-end; width: 20px; height: 20px; padding: 0; border: 0; background: none; color: var(--thin); font-size: 15px; line-height: 1; cursor: pointer; }
    .popover { position: fixed; inset: auto; margin: 0; max-width: 200px; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--thin); border-radius: 8px; background: var(--card); color: var(--fg); font-size: 13px; }
    .original { margin-top: 12px; } .original-button { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 6px; font: inherit; color: var(--fg); background: none; border: 1px solid var(--line); border-radius: 6px; cursor: pointer; }
    .tear { margin: 4px -12px 8px; border-top: 2px dotted var(--line); } .sub .title { font-size: 13px; } .sub .rating strong { font-size: 20px; }
    .spinner.small { width: 14px; height: 14px; border-width: 2px; }
    .none { padding: 8px 12px; }
    .wait { align-items: center; padding: 8px 12px; }
    .spinner { width: 20px; height: 20px; box-sizing: border-box; border: 3px solid #8885; border-top-color: var(--accent); border-radius: 50%; animation: turn .8s linear infinite; }
    @keyframes turn { to { transform: rotate(360deg); } }`;
  const frame = box('div', null, 'frame');
  frame.role = 'dialog';
  const spinner = box('span', null, 'spinner');
  spinner.role = 'status';
  spinner.setAttribute('aria-label', t.finding);
  frame.classList.add('wait');
  const label = box('span', t.finding);
  frame.append(spinner, label);
  // background.js says when the ISBN is found and the Goodreads lookup starts
  let siteButton; // the card's auto-search link, once there is a card
  const showSite = (enabled) => { if (siteButton) siteButton.textContent = enabled ? t.autoOff : t.autoOn; };
  const onSearching = (message) => {
    if (message?.siteChanged) chrome.runtime.sendMessage({ siteState: true }).then((answer) => answer && showSite(answer.enabled)).catch(() => {}); // added or removed by the grant page, the menu or the options
    if (message?.searching) { if (t.auto && !closed) document.documentElement.append(host); /* auto-mode shows itself only now, once the ISBN is found */ label.textContent = t.loading; spinner.setAttribute('aria-label', t.loading); } };
  chrome.runtime.onMessage.addListener(onSearching);
  root.append(style, frame);
  if (!t.auto) document.documentElement.append(host); // auto-mode stays invisible until it has something to say

  let closed = false;
  const close = () => {
    closed = true;
    chrome.runtime.onMessage.removeListener(onSearching);
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
  if (closed) return; // closed while waiting
  if (t.auto) {
    if (problem === 'noIsbn') return close(); // silent when there is no book here
    document.documentElement.append(host);
  }

  frame.replaceChildren();
  frame.classList.remove('wait');
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
    img.className = 'cover';
    frame.append(img);
  }
  const body = box('div', null, 'body');
  body.append(box('div', card.title, 'title'));
  if (card.author) body.append(box('div', card.author.name, 'meta'));
  const ratingBox = (r) => { // like the app: gold star, big number, small count (orange, with a warning popover, when thin)
    const rating = box('div', null, 'rating');
    rating.title = r.title;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.5l-5.9 3.1 1.2-6.5L2.5 9.5l6.6-.9z');
    svg.append(path);
    rating.append(svg, box('strong', r.value), box('span', `(${r.count})`, r.thin ? 'count thin' : 'count'));
    if (r.thin) {
      const warning = box('button', '⚠\uFE0E', 'warning');
      warning.type = 'button';
      warning.setAttribute('aria-label', `${t.thinLabel}: ${t.thin}`);
      const popover = box('div', t.thin, 'popover');
      popover.popover = 'auto';
      warning.popoverTargetElement = popover;
      popover.addEventListener('beforetoggle', (event) => {
        if (event.newState !== 'open') return;
        const at = warning.getBoundingClientRect();
        popover.style.top = `${at.bottom + 6}px`;
        popover.style.left = `${Math.max(8, Math.min(at.left, innerWidth - 200 - 8))}px`;
      });
      rating.append(warning, popover);
    }
    return rating;
  };
  if (card.rating) body.append(ratingBox(card.rating));
  const links = box('div', null, 'links');
  for (const { name, url, title, icon } of card.links) {
    const link = box('a');
    const img = document.createElement('img');
    img.src = icon; // our own copy of the site's icon (see icons/README.md)
    img.alt = '';
    link.append(img, name);
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = title;
    links.append(link);
  }
  body.append(links);
  { // a button, then a sub-card under a dotted seam (nothing is stored)
    const slot = box('div', null, 'original');
    const offer = (message) => {
      const button = box('button', t.originalButton, 'original-button');
      button.onclick = async () => {
        button.disabled = true;
        const ring = box('span', null, 'spinner small');
        ring.role = 'status';
        ring.setAttribute('aria-label', t.originalLooking);
        button.replaceChildren(ring, t.originalLooking);
        const answer = await chrome.runtime.sendMessage({ originalFor: card.isbn }).catch(() => null);
        if (closed) return;
        if (answer?.original) {
          const { title, rating, url } = answer.original;
          const sub = box('div', null, 'sub');
          const link = box('a', 'Goodreads');
          link.href = url; // already limited to goodreads.com/book/show by cleanOriginal
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          sub.append(box('div', t.originalLabel, 'meta'), box('div', title, 'title'), ...(rating ? [ratingBox(rating)] : []), link);
          slot.replaceChildren(box('div', null, 'tear'), sub);
        } else if (answer?.problem === 'no-original') slot.replaceChildren(box('div', t.originalNone, 'meta')); // a final answer: no retry
        else offer(answer?.problem === 'not-found' ? t.originalMissing : t.originalDown); // the button stays for a retry
      };
      slot.replaceChildren(...(message ? [box('div', message, 'meta')] : []), button);
      if (message) button.focus();
    };
    offer();
    body.append(slot);
  }
  const site = box('button', t.enabled ? t.autoOff : t.autoOn, 'site');
  siteButton = site;
  site.onclick = async () => {
    const answer = await chrome.runtime.sendMessage({ toggleSite: true }).catch(() => null);
    if (answer) showSite(answer.enabled);
  };
  body.append(site);
  const x = box('button', '×', 'close');
  x.setAttribute('aria-label', t.close);
  x.onclick = close;
  frame.append(body, x);
})();
