# Spool Tare

A database of empty 3D-printer filament spool weights, with a calculator that tells you how much
filament is left: weigh the spool, subtract the empty weight.

The site is static (plain HTML, CSS and JavaScript, no build step) and is meant to be hosted on GitHub Pages.
It has two pages: the calculator (`index.html`) and the full list of spools (`spools.html`).

## Adding a spool

Use **Add a spool** at the bottom of the *All spools* page (the calculator links to it when a search
finds nothing), or open an issue with the *Add a spool* form. Either way:

1. The form creates an issue. A photo can be dragged into it.
2. The `Spool submission` workflow reads the issue, matches the manufacturer against the existing
   names and aliases, converts the photo, and opens a pull request. It replies on the issue with the
   result, including warnings for a new manufacturer or a likely duplicate.
3. A maintainer merges the pull request. The site updates and the issue closes.

## Working locally

```sh
python3 -m http.server 8000     # then open http://localhost:8000
node scripts/validate.mjs       # check the data files
```

## Adding a language

Copy `i18n/en.json` to `i18n/<code>.json`, translate the values, and add the code to `LANGUAGES`
at the top of `assets/app.js`.

## Where the data comes from

The database covers a short list of current, popular brands. Entries come from three places, recorded
in each spool's `source`:

- **Imported**: the better-described entries for these brands from
  [emptyspool.github.io](https://github.com/emptyspool/emptyspool.github.io), which rebuilt a RepRap wiki
  table from a [3D Printing Stack Exchange answer](https://3dprinting.stackexchange.com/a/23154/46763)
  by Greenonline. The rest of that table (other brands, entries with no year or description) was left out.
- **Manufacturer**: values the manufacturer publishes, with a link to the page.
- **Measured**: spools weighed by contributors.
