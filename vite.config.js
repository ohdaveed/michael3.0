import { defineConfig } from "vite";
import { resolve } from "path";
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  copyFileSync,
} from "fs";
import { ViteImageOptimizer } from "vite-plugin-image-optimizer";
import { BOOKING_URL } from "./public/js/booking-url.js";

// Base URL of the live site. Must match the canonical/og:url tags in every
// public/*.html page — see CLAUDE.md if the hostname ever changes.
const SITE_URL = "https://www.lehr-law.com/";

// Matches `<!--#include:partials/foo.html?KEY=value-->` in the page HTML and
// inlines the referenced partial, substituting any `{{KEY}}` placeholders it
// contains. Runs both in dev (per-request) and build (per emitted page),
// since Vite calls transformIndexHtml in both modes.
const INCLUDE_PATTERN = /<!--\s*#include:([^\s?]+)(?:\?([^\s]*))?\s*-->/g;

// Tokens substituted in every partial and page, without needing an include
// query param. Must be applied to partials BEFORE the unmatched-token
// cleanup below, or `{{BOOKING_URL}}` would be silently stripped to "".
const GLOBAL_TOKENS = { BOOKING_URL };

function substituteGlobalTokens(html) {
  let out = html;
  for (const [key, value] of Object.entries(GLOBAL_TOKENS)) {
    // Tokens land inside HTML attribute values (href), so escape "&" to
    // keep the emitted markup valid; browsers decode &amp; back to &.
    out = out.replaceAll(`{{${key}}}`, value.replaceAll("&", "&amp;"));
  }
  return out;
}

function htmlIncludePlugin() {
  return {
    name: "html-include",
    transformIndexHtml(html) {
      const withIncludes = html.replace(
        INCLUDE_PATTERN,
        (match, file, query) => {
          let partial = readFileSync(
            resolve(__dirname, "public", file),
            "utf-8",
          );
          const params = new URLSearchParams(query ?? "");
          for (const [key, value] of params) {
            partial = partial.replaceAll(`{{${key}}}`, value);
          }
          partial = substituteGlobalTokens(partial);
          return partial.replace(/\{\{[A-Z_]+\}\}/g, "");
        },
      );
      return substituteGlobalTokens(withIncludes);
    },
  };
}

// Images referenced only inside partials (nav.html, footer.html), as a
// plain JSON-LD string, or via absolute og:image/twitter:image URLs (not an
// actual tag attribute) are never seen by Vite's own asset-reference scan,
// so they don't get bundled/copied automatically. Copy them into the build
// output directly so /images/<name> resolves on the live site.
const STATIC_IMAGES = [
  "logo-mark.svg",
  "logo-mark-square.png",
  "michael-lehr.webp",
];

function staticImagesPlugin() {
  return {
    name: "static-images",
    writeBundle() {
      const outDir = resolve(__dirname, "dist/images");
      mkdirSync(outDir, { recursive: true });
      for (const file of STATIC_IMAGES) {
        copyFileSync(
          resolve(__dirname, "public/images", file),
          resolve(outDir, file),
        );
      }
    },
  };
}

// Emits sitemap.xml and robots.txt into the build output. Replaces
// vite-plugin-sitemap, which strips the ".html" extension from every URL —
// the Bluehost host serves the pages only at their ".html" paths (no
// rewrites), so extension-less sitemap entries 404 and contradict each
// page's canonical tag. URLs here must stay in the same form as the
// <link rel="canonical"> tags.
function seoFilesPlugin() {
  return {
    name: "seo-files",
    writeBundle() {
      const outDir = resolve(__dirname, "dist");
      const pages = readdirSync(outDir)
        .filter((f) => f.endsWith(".html"))
        .filter((f) => f !== "thank-you.html") // noindex — keep out of the sitemap
        .map((f) => (f === "index.html" ? SITE_URL : `${SITE_URL}${f}`))
        .sort();
      const urlset = pages
        .map((loc) => `  <url>\n    <loc>${loc}</loc>\n  </url>`)
        .join("\n");
      writeFileSync(
        resolve(outDir, "sitemap.xml"),
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
          `${urlset}\n</urlset>\n`,
      );
      writeFileSync(
        resolve(outDir, "robots.txt"),
        `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}sitemap.xml\n`,
      );
    },
  };
}

export default defineConfig({
  root: "public",
  plugins: [
    htmlIncludePlugin(),
    staticImagesPlugin(),
    ViteImageOptimizer({
      png: {
        quality: 80,
      },
      jpeg: {
        quality: 80,
      },
      jpg: {
        quality: 80,
      },
      webp: {
        quality: 80,
      },
      svg: {
        multipass: true,
      },
    }),
    seoFilesPlugin(),
  ],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "public/index.html"),
        contact: resolve(__dirname, "public/contact.html"),
        faq: resolve(__dirname, "public/faq.html"),
        services: resolve(__dirname, "public/services.html"),
        process: resolve(__dirname, "public/process.html"),
        results: resolve(__dirname, "public/results.html"),
        thankYou: resolve(__dirname, "public/thank-you.html"),
        whatToExpect: resolve(__dirname, "public/what-to-expect.html"),
        privacyPolicy: resolve(__dirname, "public/privacy-policy.html"),
        disclaimer: resolve(__dirname, "public/disclaimer.html"),
        attorneyAdvertising: resolve(
          __dirname,
          "public/attorney-advertising.html",
        ),
      },
    },
  },
});
