# Dillard Construction Group — Website (v2)

Static replacement for the Wix site at dillardconstructiongroup.com. No build step, no dependencies — open `index.html` in a browser to preview.

## Quick start

1. **Preview locally:** open `index.html` (or `npx serve dillard-construction-site`).
2. **Drop in the real logo:** put the logo file at `img/logo.png` (or `.svg`), then in every page's header/footer replace the two placeholder spans inside `<a class="logo">` with `<img src="img/logo.png" alt="Dillard Construction Group">`. Sizing is already handled in CSS. Brand colors live in the `:root` tokens at the top of `css/site.css` — swap `--amber`/`--ink` there to match the logo palette and the whole site follows.
3. **Fill placeholders:** search the HTML files for `[` — every bracketed item is a fact to supply (project quantities, EMR, fleet counts, pay ranges, review quotes). Photo placeholders are labeled with the exact shot needed; drop files in `img/`.
4. **Forms:** get a free access key at web3forms.com (use brian@dillardconstructiongroup.com), then replace `YOUR-WEB3FORMS-ACCESS-KEY` in both forms in `contact.html`. Submissions arrive by email; success page (`thanks.html`) is already wired.
5. **Deploy on Vercel** (same account as HammerTrack):
   - Vercel → Add New Project → import `briandillardre/hello-world`
   - **Root Directory:** `dillard-construction-site` · Framework preset: **Other** · no build command · output dir `.`
   - `vercel.json` handles clean URLs (`/about` → `about.html`), redirects for the old Wix paths (`/photos`, `/request-an-estimate`), and cache/security headers.
6. **Go live:** add dillardconstructiongroup.com in the Vercel project's Domains tab, update Namecheap DNS (same process as hammertrackai.com), wait for propagation, then cancel the Wix plan.
7. **Post-launch (same week):** Google Search Console — submit `sitemap.xml`; update the website link on Google Business Profile, Facebook, Instagram, LinkedIn.

## Docs

- `docs/ONLINE-PRESENCE-AUDIT.md` — full current-state audit: site, SEO, reviews, citations, data brokers, entity issues, priority fixes.
- `docs/REDESIGN-STRATEGY.md` — brand direction, IA, exit-positioning rationale, migration workflow, content rhythm, roadmap.

## Editing

- All styling lives in `css/site.css` (design tokens at the top).
- Header/footer are duplicated per page (plain HTML) — edit all pages when changing nav. If that gets old, this folder ports cleanly to Astro/Eleventy later.
- Keep title pattern: `Page Name | Dillard Construction Group`.
- Verified license facts baked in: SC GC **#122431**, Group 5 (BD5/GD5/AP5/WL5/HI5), first issued 10/03/2019, zero board actions; USDOT 4392256.
