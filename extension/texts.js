// The extension's own texts (Ukrainian only, like the app); the app's shared ones are in shared/strings.js.
export const frame = {
  // why there is no card, by `problem` (see background.js)
  problems: {
    noIsbn: 'Не бачу ISBN. Це точно сторінка книги? 🥸',
    extension: 'Розширення не відповідає (фоновий скрипт) 😴',
    missing: 'Не знайшов книгу на Goodreads 🤷‍♂️',
    offline: 'Немає зв’язку із сервісом пошуку ⚡️',
    timeout: 'Сервіс пошуку не відповів вчасно 🤖',
    busy: 'Сервіс пошуку зайнятий, спробуйте пізніше 🤖',
    error: 'Сервіс пошуку відповів помилкою 🤖',
    invalid: 'Сервіс пошуку відповів незрозуміло 🤖',
  },
  close: 'Закрити',
  loading: 'Шукаю книгу на Goodreads… 🔍',
  ratingTitle: (value, count) => `Рейтинг на Goodreads: ${value} з 5, ${count} оцінок`,
};
