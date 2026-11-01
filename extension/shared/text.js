// Text that came from the user or the lookup service: trimmed, runs of whitespace collapsed, cut to `max`.
// Anything that is not a string becomes ''.
export const cleanText = (value, max) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '');
