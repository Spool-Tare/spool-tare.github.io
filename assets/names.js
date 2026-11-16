// Name matching shared by the site and the data scripts (no browser or Node APIs here).

const stripAccents = (s) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

/** Comparison key: "3D-Fuel", "3d fuel" and "3DFuel" all become "3dfuel". */
export const key = (s) => stripAccents(String(s)).toLowerCase().replace(/[^a-z0-9]+/g, '');

/** URL/id-safe slug: "Prusa Research" -> "prusa-research". */
export const slug = (s) =>
  stripAccents(String(s)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Finds a manufacturer by name or alias, ignoring case, accents and punctuation. */
export function findManufacturer(manufacturers, name) {
  const k = key(name);
  if (!k) return undefined;
  return manufacturers.find((m) => key(m.name) === k || (m.aliases ?? []).some((a) => key(a) === k));
}

export function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/** Manufacturers whose name is close to `name` (likely typos or spelling variants). */
export function similarManufacturers(manufacturers, name) {
  const k = key(name);
  return manufacturers.filter((m) =>
    [m.name, ...(m.aliases ?? [])].some((n) => {
      const other = key(n);
      return (
        levenshtein(k, other) <= 2 ||
        (k.length >= 4 && other.length >= 4 && (other.startsWith(k) || k.startsWith(other)))
      );
    }),
  );
}
