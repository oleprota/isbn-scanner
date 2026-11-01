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

export const auto = {
  on: 'Автопошук на цьому сайті',
  off: 'Вимкнути автопошук на цьому сайті',
};

export const options = {
  title: 'Автопошук книги',
  master: 'Шукати книгу автоматично на сайтах зі списку',
  sites: 'Сайти з автопошуком',
  empty: 'Поки жодного. Натисніть «Автопошук на цьому сайті» на картці книги.',
  remove: 'Прибрати',
};

export const grant = {
  ask: (site) => `Шукати книгу автоматично на ${site}?`,
  allow: 'Дозволити',
  done: 'Готово. Тепер книга шукатиметься сама після завантаження сторінок цього сайту. Цю вкладку можна закрити.',
  denied: 'Доступ не надано, автопошук не ввімкнено.',
};
