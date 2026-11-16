// Checks data/manufacturers.json and data/spools.json. Exits with code 1 on any problem.
// Usage: node scripts/validate.mjs
import { existsSync } from 'node:fs';
import { MANUFACTURERS_FILE, SPOOLS_FILE, SPOOL_MATERIALS, DIMENSIONS, SOURCE_TYPES, GLOBAL, COUNTRY_CODES, readJson, key } from './lib.mjs';

const manufacturers = readJson(MANUFACTURERS_FILE);
const spools = readJson(SPOOLS_FILE);
const errors = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);

const seenNames = new Map();
const manufacturerIds = new Set();
for (const m of manufacturers) {
  const where = `manufacturer "${m.id}"`;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(m.id ?? '')) fail(where, 'id must be lowercase letters, digits and dashes');
  if (manufacturerIds.has(m.id)) fail(where, 'duplicate id');
  manufacturerIds.add(m.id);
  if (!m.name?.trim()) fail(where, 'name is required');
  if (!Array.isArray(m.aliases)) fail(where, 'aliases must be a list');
  for (const n of [m.name, ...(m.aliases ?? [])]) {
    const k = key(n ?? '');
    if (seenNames.has(k) && seenNames.get(k) !== m.id) {
      fail(where, `"${n}" is the same name as one used by "${seenNames.get(k)}" — merge them`);
    }
    seenNames.set(k, m.id);
  }
}

const isPositive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
const spoolIds = new Set();
const thisYear = new Date().getFullYear();
for (const s of spools) {
  const where = `spool "${s.id}"`;
  if (spoolIds.has(s.id)) fail(where, 'duplicate id');
  spoolIds.add(s.id);
  if (!manufacturerIds.has(s.manufacturer)) fail(where, `unknown manufacturer "${s.manufacturer}"`);
  if (!s.id?.startsWith(s.manufacturer + '-')) fail(where, 'id must start with the manufacturer id');
  if (s.country !== GLOBAL && !COUNTRY_CODES.includes(s.country)) fail(where, `country must be "${GLOBAL}" or a two-letter ISO country code`);
  if (typeof s.variant !== 'string') fail(where, 'variant must be text (may be empty)');
  if (!Array.isArray(s.filaments) || s.filaments.some((x) => typeof x !== 'string' || !x.trim())) {
    fail(where, 'filaments must be a list of filament names (may be empty)');
  }
  if (s.dimensions !== null) {
    const keys = Object.keys(s.dimensions ?? {});
    if (!keys.length || keys.some((k) => !DIMENSIONS.includes(k) || !isPositive(s.dimensions[k]))) {
      fail(where, `dimensions must be null or hold positive numbers for: ${DIMENSIONS.join(', ')}`);
    }
  }
  if (s.filament_g !== null && !isPositive(s.filament_g)) fail(where, 'filament_g must be a positive number or null');
  if (s.spool_material !== null && !SPOOL_MATERIALS.includes(s.spool_material)) {
    fail(where, `spool_material must be null or one of: ${SPOOL_MATERIALS.join(', ')}`);
  }
  if (!isPositive(s.weight_g) || s.weight_g > 5000) fail(where, 'weight_g must be between 1 and 5000');
  if (('weight_min_g' in s) !== ('weight_max_g' in s)) fail(where, 'weight_min_g and weight_max_g go together');
  if ('weight_min_g' in s && !(s.weight_min_g <= s.weight_g && s.weight_g <= s.weight_max_g)) {
    fail(where, 'expected weight_min_g <= weight_g <= weight_max_g');
  }
  if (s.year !== null && !(Number.isInteger(s.year) && s.year >= 2000 && s.year <= thisYear + 1)) {
    fail(where, 'year must be null or a plausible year');
  }
  if (typeof s.comment !== 'string') fail(where, 'comment must be text (may be empty)');
  const src = s.source;
  if (!src || !SOURCE_TYPES.includes(src.type)) fail(where, `source.type must be one of: ${SOURCE_TYPES.join(', ')}`);
  else {
    if (typeof src.by !== 'string' || !src.by.trim()) fail(where, 'source.by is required (who sent it, or the dataset it came from)');
    if (src.url != null && !/^https?:\/\//.test(src.url)) fail(where, 'source.url must be null or a web address');
    if (src.issue != null && !Number.isInteger(src.issue)) fail(where, 'source.issue must be an issue number');
  }
  if (typeof s.verified !== 'boolean') fail(where, 'verified must be true or false');
  if (s.image !== null) {
    if (typeof s.image !== 'string') fail(where, 'image must be null or a path');
    else if (!/^https:\/\//.test(s.image) && !existsSync(s.image)) fail(where, `image file not found: ${s.image}`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`\n${errors.length} problem(s) found.`);
  process.exit(1);
}
console.log(`OK: ${spools.length} spools, ${manufacturers.length} manufacturers.`);
