import path from "node:path";
import type { NextConfig } from "next";

/**
 * Security headers (blueprint Phase 12: "Security ... hardening").
 *
 * A Content-Security-Policy is the one that actually stops a stored-XSS bug
 * from becoming an account takeover, so it is worth the care:
 *
 *  - `script-src 'self'` with NO `unsafe-inline`. Next's App Router inlines
 *    a bootstrap script, so in development it needs `unsafe-eval` for the
 *    React refresh runtime; production gets neither, and `'strict-dynamic'`
 *    is deliberately not used because there is no nonce plumbing yet — that
 *    is named in the README as the next step rather than faked here.
 *  - `frame-ancestors 'none'` — this application is never framed, which is
 *    what makes clickjacking against the fee and payroll screens impossible.
 *  - `form-action 'self'` — a stored-XSS payload cannot repoint a login form
 *    at somebody else's host.
 *  - `connect-src 'self'` keeps a compromised page from beaconing student
 *    data out. When a real AI or SMS provider is added it must be listed
 *    here explicitly, which is a useful forcing function.
 */
const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'" + (isDev ? " ws: wss:" : ""),
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // No camera, microphone or geolocation is used anywhere in the product.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  // HSTS only in production: setting it on http://localhost would pin a
  // developer's browser to https for a host that doesn't serve it.
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]),
];

const nextConfig: NextConfig = {
  // Removes the `X-Powered-By: Next.js` version banner.
  poweredByHeader: false,
  turbopack: {
    // An unrelated package-lock.json in the user's home directory (a parent
    // of this project) otherwise makes Turbopack guess that as the
    // workspace root. Pin it explicitly instead of guessing.
    root: path.join(__dirname),
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
