// Turns a "Add a spool" issue into a change to the data files.
// Run by .github/workflows/submission.yml; reads the issue from GITHUB_EVENT_PATH.
//
// Outcome, written to GITHUB_OUTPUT:
//   ok=true|false
// and to submission-result.md: the comment to post on the issue (and the pull request body).
//
// Local test: node scripts/process-issue.mjs path/to/event.json  (add --dry-run to leave the data untouched)
import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import {
  MANUFACTURERS_FILE, SPOOLS_FILE, SPOOL_MATERIALS, GLOBAL, COUNTRY_CODES, readJson, writeJson, slug,
  findManufacturer, similarManufacturers, parseGrams, parseWeight, nextSpoolId, sortManufacturers,
} from './lib.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const eventPath = args.find((a) => !a.startsWith('--')) ?? process.env.GITHUB_EVENT_PATH;
const issue = readJson(eventPath).issue;

// Headings of the issue form (.github/ISSUE_TEMPLATE/spool-addition.yml) -> field.
const HEADINGS = {
  'Manufacturer': 'manufacturer',
  'Country where it is sold': 'country',
  'Spool variant': 'variant',
  'Filaments sold on this spool': 'filaments',
  'Outer diameter (mm)': 'outer_mm',
  'Width (mm)': 'width_mm',
  'Hole diameter (mm)': 'hole_mm',
  'Filament weight when new': 'filament',
  'Spool is made of': 'spool_material',
  'Empty spool weight (g)': 'weight',
  'Year': 'year',
  'Where the weight comes from': 'source_type',
  'Link to the source': 'source_url',
  'Notes': 'comment',
  'Photo': 'photo',
};

function parseBody(body) {
  const fields = {};
  for (const section of String(body ?? '').replace(/\r/g, '').split(/^### /m).slice(1)) {
    const newline = section.indexOf('\n');
    const heading = (newline < 0 ? section : section.slice(0, newline)).trim();
    const value = newline < 0 ? '' : section.slice(newline).trim();
    const field = HEADINGS[heading];
    if (field) fields[field] = /^(_No response_|None)$/.test(value) ? '' : value;
  }
  return fields;
}

const oneLine = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const f = parseBody(issue.body);
const errors = [];
const warnings = [];

const manufacturerName = oneLine(f.manufacturer, 60);
if (!manufacturerName || !slug(manufacturerName)) errors.push('**Manufacturer** is required.');

const weight = parseWeight(f.weight);
if (!weight) errors.push('**Empty spool weight** must be a number in grams, like `212`, or a range like `210-216`.');
else if (weight.weight_g > 5000 || (weight.weight_min_g ?? weight.weight_g) < 5) {
  errors.push('**Empty spool weight** must be between 5 and 5000 g. Check that it is in grams.');
}

// Country: empty or "Global", a two-letter code, or the country's name in English.
let country = GLOBAL;
const typedCountry = oneLine(f.country, 60);
if (typedCountry && !/^(global|worldwide)$/i.test(typedCountry)) {
  const englishNames = new Intl.DisplayNames(['en'], { type: 'region' });
  const match = COUNTRY_CODES.find((c) => c === typedCountry.toUpperCase() || englishNames.of(c).toLowerCase() === typedCountry.toLowerCase());
  if (match) country = match;
  else errors.push('**Country where it is sold** must be `Global`, a two-letter code like `BR`, or the country name in English like `Brazil`.');
}

const filaments = [...new Set(String(f.filaments ?? '').split(/[,;\n]/).map((x) => oneLine(x, 30)).filter(Boolean))].slice(0, 12);

const dimensions = {};
for (const [field, label] of [['outer_mm', 'Outer diameter'], ['width_mm', 'Width'], ['hole_mm', 'Hole diameter']]) {
  if (!f[field]) continue;
  const mm = Number(String(f[field]).replace(',', '.').match(/\d+(?:\.\d+)?/)?.[0]);
  if (mm >= 5 && mm <= 500) dimensions[field] = mm;
  else errors.push(`**${label}** must be a number in millimetres between 5 and 500.`);
}

const filament_g = f.filament ? parseGrams(f.filament) : null;
if (f.filament && !filament_g) errors.push('**Filament weight when new** was not understood. Use values like `1 kg` or `750 g`.');

const spoolMaterial = SPOOL_MATERIALS.find((m) => String(f.spool_material ?? '').toLowerCase().startsWith(m)) ?? null;

let year = null;
if (f.year) {
  year = Number(f.year.trim());
  if (!Number.isInteger(year) || year < 2000 || year > new Date().getFullYear() + 1) {
    errors.push('**Year** must be a four-digit year, like `2024`.');
  }
}

// Who sent it and where the number comes from.
const sourceType = /^manufacturer/i.test(f.source_type ?? '') ? 'manufacturer' : /^other/i.test(f.source_type ?? '') ? 'other' : 'measured';
const sourceUrl = String(f.source_url ?? '').trim().match(/^https?:\/\/[^\s<>"'`]{4,300}$/)?.[0] ?? null;
if (f.source_url && !sourceUrl) warnings.push('The **Link to the source** was ignored because it is not a web address.');

// Only images uploaded to the issue itself are accepted.
const photoUrl = String(f.photo ?? '').match(
  /https:\/\/(?:github\.com\/user-attachments\/assets\/[\w-]+|(?:private-)?user-images\.githubusercontent\.com\/[\w\-./%]+)/,
)?.[0];
if (f.photo && !photoUrl) {
  warnings.push('The photo was ignored: drag the image file into the **Photo** box so it is uploaded to this issue (links to other sites are not used).');
}

async function savePhoto(url, id) {
  const res = await fetch(url, { headers: process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {} });
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > 20 * 1024 * 1024) throw new Error('file is larger than 20 MB');
  const { default: sharp } = await import('sharp');
  // Re-encoding drops EXIF data (camera, GPS position) and anything that is not an image.
  const out = await sharp(data).rotate().resize(1400, 1400, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  const path = `images/spools/${id}.webp`;
  mkdirSync('images/spools', { recursive: true });
  writeFileSync(path, out);
  return path;
}

let summary = '';
if (!errors.length) {
  const manufacturers = readJson(MANUFACTURERS_FILE);
  const spools = readJson(SPOOLS_FILE);

  let manufacturer = findManufacturer(manufacturers, manufacturerName);
  if (!manufacturer) {
    const similar = similarManufacturers(manufacturers, manufacturerName).map((m) => `\`${m.name}\``);
    let id = slug(manufacturerName);
    while (manufacturers.some((m) => m.id === id)) id += '-x';
    manufacturer = { id, name: manufacturerName, aliases: [] };
    manufacturers.push(manufacturer);
    sortManufacturers(manufacturers);
    warnings.push(
      `\`${manufacturerName}\` is a **new manufacturer**.` +
        (similar.length ? ` Similar existing names: ${similar.join(', ')} — if it is one of those, edit the issue to use that name.` : ''),
    );
  }

  const twins = spools.filter(
    (s) => s.manufacturer === manufacturer.id && s.country === country && (s.filament_g ?? null) === filament_g && s.spool_material === spoolMaterial && Math.abs(s.weight_g - weight.weight_g) <= 3,
  );
  if (twins.length) {
    warnings.push(`Possible duplicate of ${twins.map((s) => `\`${s.id}\` (${s.weight_g} g)`).join(', ')}.`);
  }

  const spool = {
    id: nextSpoolId(spools, manufacturer.id),
    manufacturer: manufacturer.id,
    country,
    spool_material: spoolMaterial,
    filament_g,
    variant: oneLine(f.variant, 60),
    ...weight,
    dimensions: Object.keys(dimensions).length ? dimensions : null,
    filaments,
    year,
    comment: oneLine(f.comment, 500),
    image: null,
    source: { type: sourceType, by: issue.user?.login ?? 'unknown', url: sourceUrl, issue: issue.number },
    verified: false,
  };

  if (photoUrl && !dryRun) {
    try {
      spool.image = await savePhoto(photoUrl, spool.id);
    } catch (e) {
      warnings.push(`The photo could not be used (${e.message}). The spool was added without it.`);
    }
  }

  spools.push(spool);
  if (!dryRun) {
    writeJson(MANUFACTURERS_FILE, manufacturers);
    writeJson(SPOOLS_FILE, spools);
  }
  summary = '```json\n' + JSON.stringify(spool, null, 2).replace(/`/g, "'") + '\n```';
}

const lines = [];
if (errors.length) {
  lines.push('This submission needs a fix before it can be added:', '', ...errors.map((e) => `- ${e}`), '',
    'Edit the issue (the **…** menu at the top of it, then **Edit**) and it will be checked again.');
} else {
  lines.push(`Spool submitted in #${issue.number}, ready for review:`, '', summary);
}
if (warnings.length) lines.push('', 'To check:', '', ...warnings.map((w) => `- ${w}`));

writeFileSync('submission-result.md', lines.join('\n') + '\n');
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `ok=${!errors.length}\n`);
console.log(lines.join('\n'));
