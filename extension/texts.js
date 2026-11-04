// The extension's own texts (Ukrainian only, like the app); the app's shared ones are in shared/strings.js.
export const frame = {
  // why there is no card, by `problem` (see background.js); a failed lookup carries its own message (card.lookupWhy in shared/strings.js)
  problems: {
    noIsbn: 'Не бачу ISBN. Це точно сторінка книги? 🥸',
    extension: 'Розширення не відповідає (фоновий скрипт) 😴',
  },
  close: 'Закрити',
  finding: 'Шукаю книгу… 🔍', // reading the page for its ISBN
  loading: 'Шукаю книгу на Goodreads… 🔍',
  ratingTitle: (value, count) => `Рейтинг на Goodreads: ${value} з 5, ${count} оцінок`,
};

export const auto = {
  menu: (on) => (on ? '✅ Автопошук книг' : '🚫 Автопошук книг'), // the icon's menu can't show a checkmark, so the title carries the state
  menuSite: (on) => (on ? '✅ Автопошук на цьому сайті' : '🚫 Автопошук на цьому сайті'),
  on: '🚫 Автопошук на цьому сайті',
  off: '✅ Автопошук на цьому сайті',
};

export const options = {
  title: 'Автопошук книги',
  master: 'Шукати книгу автоматично на сайтах зі списку',
  sites: 'Сайти з автопошуком',
  empty: 'Поки жодного. Натисніть «Автопошук на цьому сайті» на картці книги.',
  remove: 'Прибрати',
  developer: 'Режим розробника',
  devCache: 'Не брати відповіді з кешу',
};

export const grant = {
  ask: 'Шукати книгу автоматично на',
  allow: 'Дозволити',
  close: 'Закрити',
  done: 'Готово! Тепер я шукатиму будь-яку книгу, яку ви відкриєте на цьому сайті.',
  denied: 'Доступ не надано, автопошук не ввімкнено.',
};
