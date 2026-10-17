import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/**", "uploads/**", "generated/**", ".fallow/**"] },
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.cjs"],
    languageOptions: { globals: globals.node },
    rules: {
      // Express handlers keep the standard (req, res, next) signature.
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
    },
  },
];
