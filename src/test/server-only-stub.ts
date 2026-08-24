/**
 * Test stub for the `server-only` marker package.
 *
 * `server-only` throws when imported outside a React Server Component
 * environment, which is exactly what makes it a useful build-time guard: if a
 * client component ever imports the processing layer, `next build` fails.
 *
 * Unit tests deliberately import those server modules directly, so Vitest
 * aliases the package to this empty module.
 */
export {};
