import js from "@eslint/js";
import globals from "globals";
import playwright from "eslint-plugin-playwright";
import prettier from "eslint-config-prettier";

// Flat config. Named `.mjs` because the root package.json has no
// `"type": "module"`, so a plain `.js` file here would be parsed as CommonJS
// and `export default` would throw.
export default [
  {
    ignores: ["dist/**", "node_modules/**", "webhook-server/**"],
  },

  // Browser modules shipped to the site. `main.js` imports these; the two
  // modules it deliberately skips (hooks.js, booking-url.js) live here too.
  {
    files: ["public/js/**/*.js"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        // Injected by third-party scripts, never declared in our source:
        // gtag by partials/head-analytics.html, Tally by its embed script.
        gtag: "readonly",
        Tally: "readonly",
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      // Four modules (funding-checklist, probate-calculator, quiz,
      // stat-counters) predate the ESM split and still use `var`. Converting
      // them is churn unrelated to adding the linter, so this stays off.
      "no-var": "off",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },

  // Playwright specs and their shared fixtures.
  {
    files: ["tests/e2e/**/*.js"],
    ...js.configs.recommended,
    ...playwright.configs["flat/recommended"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      // Node for the test process itself, browser for the snippets passed to
      // page.evaluate() — those execute in the page, not in Node.
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...playwright.configs["flat/recommended"].rules,
    },
  },

  // Root build/test config. Both use ESM syntax; vite.config.js additionally
  // relies on `__dirname`, which Vite provides when it loads the file.
  {
    files: ["vite.config.js", "playwright.config.js"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node, __dirname: "readonly" },
    },
    rules: js.configs.recommended.rules,
  },

  // Last, so no stylistic rule fights Prettier.
  prettier,
];
