import baseConfig from "@studio/eslint-config/base.js";

export default [
  ...baseConfig,
  {
    ignores: ["dist/**"],
  },
];
