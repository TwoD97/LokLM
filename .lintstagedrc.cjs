const SKIP = ['docs/superpowers/'];

const filter = (files) =>
  files.filter((f) => !SKIP.some((p) => f.replace(/\\/g, '/').includes(p)));

const quote = (files) => files.map((f) => `"${f}"`).join(' ');

module.exports = {
  '*.{ts,tsx}': (files) => {
    const kept = filter(files);
    if (!kept.length) return [];
    return [`prettier --write ${quote(kept)}`, `eslint --fix ${quote(kept)}`];
  },
  '*.{json,md,yml,yaml,css,html}': (files) => {
    const kept = filter(files);
    if (!kept.length) return [];
    return [`prettier --write ${quote(kept)}`];
  },
};
