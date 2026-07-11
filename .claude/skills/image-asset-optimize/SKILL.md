---
name: image-asset-optimize
description: Checks new or changed images under public/images/ are appropriately formatted, sized, and compressed before commit, given this site's existing sharp/svgo/vite-plugin-image-optimizer pipeline. Use when the user adds an image to the site, asks to optimize images, or reports slow-loading pages caused by image weight.
---

# Image Asset Optimization

`vite-plugin-image-optimizer` already compresses png/jpeg/jpg/webp at quality
80 and runs `svgo` multipass on SVGs at **build time** (see `vite.config.js`),
so committed images don't need manual compression — but build-time
compression can't fix wrong format, oversized source dimensions, or a
missing responsive strategy. This skill checks what the build pipeline
can't.

## Steps

1. **Identify new/changed images** — `git status public/images/` or check
   the diff for the specific asset in question.

2. **Check format is appropriate for content:**
   - Photos → `.webp` (this repo already uses webp for its one existing
     image, `michael-lehr.webp`) — prefer over `.jpg`/`.png` for new photos.
   - Icons/logos/illustrations with flat colors or transparency → `.svg` if
     vector-sourced, otherwise `.webp`/`.png`.
   - Avoid `.png` for photographic content — much larger than webp/jpeg at
     equivalent visual quality.

3. **Check source dimensions aren't wildly oversized.** The optimizer
   compresses quality, not dimensions — a 4000px-wide source served in a
   400px container wastes bandwidth regardless of compression. Compare the
   image's actual pixel dimensions (`file <image>` or `identify` if
   ImageMagick is available) against its rendered size in the HTML/CSS.
   Flag anything more than ~2x the largest rendered size (accounting for
   retina).

4. **Check the `<img>` markup**, not just the file:
   - `alt` text present and meaningful (also relevant to `a11y-audit` —
     don't duplicate that full audit here, just flag missing alt on the
     asset in question).
   - `width`/`height` attributes present to prevent layout shift (Lighthouse
     CLS), unless CSS explicitly controls aspect ratio.
   - `loading="lazy"` on below-the-fold images.

5. **Verify against `.gitignore`/repo conventions** — confirm the image
   actually belongs in `public/images/` (the served path) and isn't
   accidentally dropped elsewhere that the Vite build won't pick up.

6. **Report** pass/fail per image with the specific issue (format, source
   dimensions, missing markup) — don't re-run or second-guess the build-time
   compression settings in `vite.config.js` unless the user is asking to
   change the optimizer's quality/settings themselves.

## When NOT to use

For overall page-load scoring (of which image weight is one factor), use
`lighthouse-perf-audit` — that skill will point back here for image-specific
fixes it identifies.
