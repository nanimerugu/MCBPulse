// Stand-in for the `server-only` package under Vitest. Next.js's bundler
// swaps `server-only` for a no-op when a module is only ever reached from
// the server; outside that bundler (i.e. in tests) its real implementation
// throws unconditionally, so it's aliased to this empty module instead.
export {};
