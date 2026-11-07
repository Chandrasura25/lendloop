/// <reference types="vite/client" />
// Test-only: lets convex-test load every Convex module. Convex skips files with more than one
// dot in the name, so this is never deployed.
export const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.*.{ts,js}"]);
