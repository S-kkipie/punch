// `server-only` throws unless the bundler resolves the react-server condition.
// Wrangler aliases the package to this empty module: a Cloudflare Worker is
// already server-side, so the guard has nothing to protect against.
export {};
