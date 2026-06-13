import type { Config } from "jest";

const config: Config = {
  // Use ts-jest to run TypeScript tests directly
  preset: "ts-jest",
  testEnvironment: "node",

  // Test files live in __tests__/ directory
  testMatch: ["<rootDir>/__tests__/**/*.test.ts"],

  // Module path aliases (match tsconfig.json paths)
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
};

export default config;
