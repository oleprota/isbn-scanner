// The extension's own texts (Ukrainian only, like the app); the app's shared ones are in shared/strings.js.
export const frame = {
  // why there is no card, by `problem` (see background.js); a failed lookup carries its own message (card.lookupWhy in shared/strings.js)
  problems: {
    noIsbn: "Не бачу ISBN. Це точно сторінка книги? 🥸",
    extension: "Розширення не відповідає 😴",
  },
  close: "Закрити",
  pick: "Не бачу ISBN. Це одна з цих книг?",
  back: "← До списку",
  finding: "Шукаю ISBN… 🔍", // reading the page for its ISBN
  loading: "Шукаю книгу на Goodreads… 🔍",
  ratingTitle: (value, count) =>
    `Рейтинг на Goodreads: ${value} з 5, ${count} оцінок`,
};

export const auto = {
  menu: (on) => (on ? "✅ Автопошук книг" : "🚫 Автопошук книг"), // the icon's menu can't show a checkmark, so the title carries the state
  menuSite: (on) =>
    on ? "✅ Автопошук на цьому сайті" : "🚫 Автопошук на цьому сайті",
  on: "🚫 Автопошук на цьому сайті",
  off: "✅ Автопошук на цьому сайті",
  onLabel: "Натисніть, щоб увімкнути", // the card's link says the state; its label says what a click does
  offLabel: "Натисніть, щоб вимкнути",
};

export const options = {
  title: "Автопошук книги",
  master: "Шукати книгу автоматично на сайтах зі списку",
  sites: "Сайти з автопошуком",
  empty: "Поки жодного. Натисніть «Автопошук на цьому сайті» на картці книги.",
  remove: "Прибрати",
  thin: "Мало оцінок — це менше, ніж:",
  thinHelp:
    "Якщо в книги мало оцінок на Goodreads, я вважатиму її рейтинг ненадійним і попереджу про це.",
  developer: "Режим розробника (на 1 годину)",
  devCache: "Не брати відповіді з кешу",
};

export const grant = {
  ask: "Шукати книгу автоматично на",
  allow: "Дозволити",
  close: "Закрити",
  done: "Готово! Тепер я шукатиму будь-яку книгу, яку ви відкриєте на цьому сайті.",
  denied: "Доступ не надано, автопошук не ввімкнено.",
};
