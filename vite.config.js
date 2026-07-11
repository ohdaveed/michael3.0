import { defineConfig } from "vite";
import { resolve } from "path";
import { readFileSync, mkdirSync, copyFileSync } from "fs";
import { ViteImageOptimizer } from "vite-plugin-image-optimizer";
import Sitemap from "vite-plugin-sitemap";

// Matches `<!--#include:partials/foo.html?KEY=value-->` in the page HTML and
// inlines the referenced partial, substituting any `{{KEY}}` placeholders it
// contains. Runs both in dev (per-request) and build (per emitted page),
// since Vite calls transformIndexHtml in both modes.
const INCLUDE_PATTERN = /<!--\s*#include:([^\s?]+)(?:\?([^\s]*))?\s*-->/g;

function htmlIncludePlugin() {
  return {
    name: "html-include",
    transformIndexHtml(html) {
      return html.replace(INCLUDE_PATTERN, (match, file, query) => {
        let partial = readFileSync(resolve(__dirname, "public", file), "utf-8");
        const params = new URLSearchParams(query ?? "");
        for (const [key, value] of params) {
          partial = partial.replaceAll(`{{${key}}}`, value);
        }
        return partial.replace(/\{\{[A-Z_]+\}\}/g, "");
      });
    },
  };
}

// Images referenced only inside partials (nav.html, footer.html) or as a
// plain JSON-LD string (not an actual tag attribute) are never seen by
// Vite's own asset-reference scan, so they don't get bundled/copied
// automatically. Copy them into the build output directly.
const STATIC_IMAGES = ["logo-mark.svg", "logo-mark-square.png"];

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
    Sitemap({
      hostname: "https://www.lehr-law.com/",
      exclude: ["/thank-you", "/thank-you.html"],
      outDir: "dist",
    }),
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
