// The settings pane: the thin-rating threshold as a stepper. − and + walk a ladder of round numbers; the number between
// them is a field, so a tap opens the numbers keyboard for any other value. `get()` is the threshold now,
// `commit(n)` applies it, saves it and redraws what depends on it.
import { el } from './dom.js';
import { cleanThin } from './settings.js';
import { settings } from './strings.js';

const text = settings.thin;
const LADDER = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];

export function mountSettings({ body, get, commit }) {
  // the number is a button with the title's dashed underline; a tap swaps in a field (numbers keyboard) in the same box
  const value = el('button', null, 'stepper-value');
  value.type = 'button';
  const step = (direction, label, symbol) => {
    const button = el('button', symbol, 'stepper-button');
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.addEventListener('click', () => {
      const now = get();
      const next = direction > 0 ? LADDER.find((n) => n > now) : [...LADDER].reverse().find((n) => n < now);
      if (next) commit(next);
      sync();
    });
    return button;
  };
  const less = step(-1, text.less, '−');
  const more = step(1, text.more, '+');
  const group = el('div', null, 'stepper');
  group.append(less, value, more);
  const label = el('p', text.label, 'setting-label');
  label.id = 'thin-label';
  value.setAttribute('aria-labelledby', label.id);
  const sync = () => {
    value.textContent = get();
    less.disabled = !LADDER.some((n) => n < get());
    more.disabled = !LADDER.some((n) => n > get());
  };
  value.addEventListener('click', () => {
    const field = el('input', null, 'stepper-input');
    field.type = 'number';
    field.min = 1;
    field.step = 1;
    field.inputMode = 'numeric';
    field.setAttribute('aria-labelledby', label.id);
    field.value = get();
    let done = false;
    const finish = (save) => { // not a number: the old value stays
      if (done) return;
      done = true;
      const count = save && cleanThin(field.value);
      if (count) commit(count);
      field.replaceWith(value);
      sync();
    };
    field.addEventListener('blur', () => finish(true));
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') finish(true);
      else if (event.key === 'Escape') finish(false);
    });
    value.replaceWith(field);
    field.focus();
    field.select();
  });
  body.replaceChildren(label, group, el('p', text.help, 'meta'));
  sync();
}
