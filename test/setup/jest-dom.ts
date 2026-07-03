// Vitest setup — registers @testing-library/jest-dom's matchers
// (toBeInTheDocument, toHaveAttribute, ...) globally for every test file, so
// P5's RTL suites don't each need their own import. jest-dom only calls
// expect.extend() at import time; it never touches document/window itself,
// so this is safe to load unconditionally even for the repo's default
// `environment: "node"` test files (see vitest.config.ts's header comment on
// why that default can't change to jsdom).
import "@testing-library/jest-dom/vitest";
