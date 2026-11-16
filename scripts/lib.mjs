// Shared helpers for the data scripts (migration, validation, issue processing).
import { readFileSync, writeFileSync } from 'node:fs';

export const SPOOL_MATERIALS = ['plastic', 'cardboard', 'metal'];
// Where a spool's data came from:
//   measured     - someone weighed the spool          manufacturer - published by the manufacturer
//   import       - copied from another dataset        other        - anything else
export const DIMENSIONS = ['outer_mm', 'width_mm', 'hole_mm'];
export const SOURCE_TYPES = ['measured', 'manufacturer', 'import', 'other'];

export const MANUFACTURERS_FILE = 'data/manufacturers.json';
export const SPOOLS_FILE = 'data/spools.json';

export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
export const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');

export { GLOBAL, COUNTRY_CODES } from '../assets/countries.js';
export { key, slug, findManufacturer, levenshtein, similarManufacturers } from '../assets/names.js';

const toNumber = (s) => Number(String(s).replace(',', '.'));

/** "1kg", "0,5 kg", "750 g", "750" -> grams. Returns null when nothing usable is found. */
export function parseGrams(text) {
  const m = String(text ?? '').match(/(\d+(?:[.,]\d+)?)\s*(kg|k\b|gr?\b)?/i);
  if (!m) return null;
  const n = toNumber(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const isKg = m[2] ? /^k/i.test(m[2]) : n < 20; // a bare "1" or "2.5" means kilograms
  return Math.round(isKg ? n * 1000 : n);
}

/**
 * Empty-spool weight: "262", "195 g", "288-294", "230.6 g".
 * A single value gives { weight_g }; several give the midpoint plus weight_min_g / weight_max_g.
 */
export function parseWeight(text) {
  const nums = (String(text ?? '').match(/\d+(?:[.,]\d+)?/g) ?? []).map(toNumber).filter((n) => n > 0);
  if (!nums.length) return null;
  if (nums.length === 1) return { weight_g: nums[0] };
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return { weight_g: Math.round((min + max) / 2), weight_min_g: min, weight_max_g: max };
}

export function nextSpoolId(spools, manufacturerId) {
  const prefix = manufacturerId + '-';
  const used = spools
    .filter((s) => s.id.startsWith(prefix))
    .map((s) => Number(s.id.slice(prefix.length)))
    .filter(Number.isInteger);
  return prefix + String(Math.max(0, ...used) + 1).padStart(2, '0');
}

export const sortManufacturers = (list) =>
  list.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
