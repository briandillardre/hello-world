# Dillard Construction Group — Website (v2)

Static replacement for the Wix site at dillardconstructiongroup.com. No build step, no dependencies — open `index.html` in a browser to preview.

## Quick start

1. **Preview locally:** open `index.html` (or `npx serve dillard-construction-site`).
2. **Fill placeholders:** search the HTML files for `[` — every bracketed item is a fact to supply (project quantities, EMR, fleet counts, pay ranges, review quotes). Photo placeholders are labeled with the exact shot needed; drop files in `img/` and swap the placeholder `div.visual` for an `<img>` or a CSS `background-image`.
3. **Deploy:** Netlify → "Add new site" → drag this folder (or connect the repo with base directory `dillard-construction-site`). Forms (`estimate`, `bid-invite`) work automatically on Netlify; enable form notifications to brian@ + nate@.
4. **Go live:** point dillardconstructiongroup.com DNS at Netlify (Namecheap → same process used for hammertrackai.com), then cancel Wix.

## Docs

- `docs/ONLINE-PRESENCE-AUDIT.md` — full current-state audit: site, SEO, reviews, citations, data brokers, entity issues, priority fixes.
- `docs/REDESIGN-STRATEGY.md` — brand direction, IA, exit-positioning rationale, migration workflow, content rhythm, roadmap.

## Editing

- All styling lives in `css/site.css` (design tokens at the top).
- Header/footer are duplicated per page (plain HTML) — edit all pages when changing nav. If that gets old, this folder ports cleanly to Astro/Eleventy later.
- Keep title pattern: `Page Name | Dillard Construction Group`.
