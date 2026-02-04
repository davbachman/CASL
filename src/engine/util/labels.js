/**
 * 0 -> a / A
 * 25 -> z / Z
 * 26 -> aa / AA
 *
 * @param {number} index
 * @param {{uppercase: boolean}} opts
 */
export function indexToLetters(index, opts) {
  const base = opts.uppercase ? 65 : 97;
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(base + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

