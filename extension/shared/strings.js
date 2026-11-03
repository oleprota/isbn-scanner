// The interface is Ukrainian only. Every text the user can see lives here, grouped by where it
// shows up; index.html carries only data-s* attributes that name a path into these groups.
// Developer-facing console messages (e.g. in scanner.js) stay in English.

// Ukrainian plurals: 1 книга, 2-4 книги, 5-20 книг, 21 книга, 22 книги, ... 11-14 are "many".
export function plural(n, [one, few, many]) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export const books = (n) => `${n} ${plural(n, ['книга', 'книги', 'книг'])}`;

// "4.66" and "734 385" (grouped for the Ukrainian locale) for a rating { value, count }.
export const formatRating = ({ value, count }) => ({
  value: value.toFixed(2),
  count: new Intl.NumberFormat('uk-UA').format(count),
});

export const page = {
  title: 'Сканер ISBN',
  localSuffix: ' (local)', // added to the tab title on localhost
  heading: 'Сканер ISBN',
  statsNote: (id, dev) => `Анонімна статистика (не про вас чи книжки) · ваш ID: ${id}${dev ? ' · dev' : ''}`,
  dev: {
    summary: 'Для розробника',
    cache: 'Кешувати результати пошуку (за замовчуванням: увімк.)',
  },
};

export const theme = {
  title: 'Тема: як на пристрої, світла чи темна',
  labels: { auto: '🌓 Авто', light: '☀️ Світла', dark: '🌙 Темна' },
  names: { auto: 'авто', light: 'світла', dark: 'темна' },
  aria: (mode) => `Тема: ${theme.names[mode]}. Натисніть, щоб змінити.`,
};

export const search = {
  placeholder: 'Назва або ISBN, напр. 978-0-14-032872-1',
  label: 'Назва або ISBN книги',
  submit: 'Пошук',
  invalidIsbn: 'Введіть дійсний ISBN-10 або ISBN-13.',
  notABook: 'Це не ISBN книги.',
  lookingUp: 'Шукаю назву…',
  searchingTitle: 'Шукаю за назвою…',
  pickBook: 'Оберіть книгу:',
  noTitleResults: 'За такою назвою нічого не знайдено.',
  searchFailed: 'Не вдалося знайти. Спробуйте ще раз.',
  gettingIsbn: 'Шукаю ISBN…',
  noIsbn: (title) => `Не вдалося дізнатись ISBN для «${title}». Спробуйте інше видання.`,
};

export const scanner = {
  scan: 'Сканувати',
  stop: 'Стоп',
  hint: 'Затисніть → серія',
  buttonTitle: 'Торкніться — 1 скан, затисніть — серія',
  instructions: 'Наведіть камеру на штрихкод на звороті книги. Не виходить? Зупиніть камеру й введіть ISBN.',
  cameraUnavailable: 'Камера недоступна. Введіть ISBN вручну.',
};

export const card = {
  // the title of a book that has no name (also stored with the lists, so keep it stable)
  isbnTitle: (isbn) => `ISBN ${isbn}`,
  ratingLabel: 'Рейтинг на Goodreads',
  ratingTitle: (value, count) => `Рейтинг на Goodreads: ${value} з 5, ${count} оцінок`,
  thinTitle: (threshold) => `Менше ${threshold} оцінок — рейтинг ненадійний`, // the warning icon's popover and tooltip
  thinLabel: 'Попередження про рейтинг',
  originalButton: 'Знайти оригінал',
  originalLooking: 'Шукаю оригінал…',
  originalLabel: 'Оригінал',
  originalMissing: 'Оригінал не знайдено',
  // What exactly happened with the original search, by the reason the lookup gives (lookupOriginal in lookup.js).
  // "Наш пошук" is our lookup service (worker/); a format hint is where Goodreads may have changed its page.
  originalWhy: ({ reason, title, status }) => {
    const format = 'Можливо, Goodreads змінив формат сторінки';
    const why = {
      offline: 'Не вдалося зв’язатися з нашим пошуком. Перевірте інтернет',
      timeout: 'Наш пошук не відповів вчасно',
      error: `Наш пошук повернув помилку${status ? ` ${status}` : ''}`,
      invalid: 'Наш пошук надіслав незрозумілу відповідь',
      'no-reason': 'Наш пошук не пояснив, чому оригіналу немає',
      busy: 'Забагато запитів. Спробуйте за хвилину',
      'page-404': 'Goodreads не знає цього ISBN',
      'page-empty': 'Goodreads віддає порожні сторінки',
      'page-refused': 'Goodreads відмовив у доступі',
      'page-down': 'Goodreads не відповідає',
      'page-no-book': `На сторінці Goodreads немає даних про книгу. ${format}`,
      'page-no-author': `На сторінці Goodreads не вказано автора. ${format}`,
      'page-no-original': 'На сторінці Goodreads немає назви оригіналу',
      'page-too-long': 'Сторінка Goodreads задовга: назву оригіналу не знайдено',
      'page-same-title': 'Це не переклад: назва оригіналу збігається з назвою книги',
      'page-no-work': `На сторінці Goodreads немає ідентифікатора твору. ${format}`,
      'search-failed': 'Пошук Goodreads не відповів',
      'search-empty': `Goodreads не знайшов «${title}»`,
      'search-other-author': `Є «${title}», але не цього автора`,
      'search-no-rating': 'Книга знайдена, але без оцінок на Goodreads',
      'search-no-work': 'Знайдену книгу не можна звірити: немає ідентифікатора твору',
      'search-ambiguous': 'Знайдено кілька різних книг: не обираю навмання',
    };
    return why[reason] ?? card.originalMissing;
  },
  originalSameWork: 'Goodreads об’єднує переклад і оригінал',
  originalWait: (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, // the countdown on the button
  originalNone: 'Goodreads не вказує оригінал цієї книги',
  originalDown: (seconds) => {
    const minutes = Math.ceil(seconds / 60); // rounded up: "try again in" must not be too early
    return `Goodreads не відповідає. Спробуйте за ${minutes} ${plural(minutes, ['хвилину', 'хвилини', 'хвилин'])}`;
  },
  seriesLabel: 'Серія',
  authorLabel: 'Автор',
  nameLabel: 'Назва книги',
  editName: 'Змінити назву',
  mark: 'Вибрати',
  isMarked: 'Вибрано (натисніть, щоб прибрати)',
  unmark: 'Прибрати з вибраного',
  linkTitle: (isbn, site) => `${isbn} на ${site}`,
  searchLinkTitle: (query, site) => `Шукати «${query}» на ${site}`,
};

export const lists = {
  names: {
    scanned: 'Шукане',
    scannedInWhat: 'Шуканому',
    marked: 'Вибране',
    markedInWhat: 'Вибраному',
  },
  empty: {
    scanned: 'Поки порожньо. Кожна книжка, яку ви шукаєте чи скануєте, з’являється тут.',
    get marked() {
      return `Нічого не вибрано. Натисніть ☆ на книзі: в «${lists.names.scannedInWhat}» або на її картці.`;
    },
  },
  copy: 'Копіювати',
  clear: 'Очистити',
  sortMenu: 'Сортування',
  sortNames: { date: 'За датою', name: 'За назвою (А–Я)', rating: 'За рейтингом' },
  fullAdvice: {
    scanned: 'Очистіть список, щоб додавати далі.',
    marked: 'Приберіть кілька книг або очистіть список, щоб додавати далі.',
  },
  added: (title) => `Додано: ${title}`,
  alreadyScanned: (title) => `Вже в «${lists.names.scannedInWhat}»: ${title}`,
  notAdded: (title) => `Не додано: ${title} (список «${lists.names.scanned}» заповнений)`,
  listFull: (list, limit, advice) => `Список «${lists.names[list]}» заповнений (${books(limit)}), цю книгу не додано. ${advice}`,
  clearScanned: (booksText) => `Очистити «${lists.names.scanned}» (${booksText})? Вибране залишиться.`,
  clearMarked: (booksText) => `Очистити «${lists.names.marked}» (${booksText})?`,
  copied: (booksText) => `Скопійовано ${booksText} до буфера.`,
  copyFailed: 'Не вдалося скопіювати.',
};

const groups = { page, theme, search, scanner, card, lists };

// Resolves "group.key.sub" from a data-s* attribute in index.html; undefined if it is not there.
export const lookup = (path) => path.split('.').reduce((o, k) => o?.[k], groups);

// data-s="path" sets an element's text, data-s-<attr>="path" sets that attribute.
export function applyStrings(root) {
  for (const node of root.querySelectorAll('*')) {
    for (const { name, value } of [...node.attributes]) {
      if (name === 'data-s') node.textContent = lookup(value);
      else if (name.startsWith('data-s-')) node.setAttribute(name.slice(7), lookup(value));
    }
  }
}
