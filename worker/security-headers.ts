import type { MiddlewareHandler } from 'hono'

/** The same baseline is applied to static assets in public/_headers. */
export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
  'X-Frame-Options': 'DENY',
  // No script restrictions until the editor and the first-paint script have a
  // tested hash/nonce policy. This baseline already prevents framing and plugins.
  'Content-Security-Policy': "object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
} as const

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next()
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) c.header(name, value)
  // A short first rollout avoids pinning a self-hosted domain for a year.
  // Do not extend this policy to subdomains controlled by someone else.
  if (new URL(c.req.url).protocol === 'https:') c.header('Strict-Transport-Security', 'max-age=300')
}
