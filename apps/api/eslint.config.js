import baseConfig from "@studio/eslint-config/base.js";

export default [
  ...baseConfig,
  {
    ignores: ["dist/**"],
  },
  {
    files: ["**/__tests__/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
