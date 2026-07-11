import { defineConfig } from "vite";
import { resolve } from "path";
import { readFileSync } from "fs";

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

export default defineConfig({
  root: "public",
  plugins: [htmlIncludePlugin()],
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
