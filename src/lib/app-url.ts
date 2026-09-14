/**
 * The public base URL, for links that leave the application — an invitation
 * or a password reset in an email.
 *
 * NEVER derived from the request. The Host and X-Forwarded-Host headers are
 * whatever the caller sends, and a reset link built from them is the classic
 * "password reset poisoning" attack: request a reset for the principal with
 * `Host: evil.example`, and the principal receives a genuine email whose link
 * hands their token to the attacker. So the URL comes from configuration,
 * and production refuses to guess.
 */
export function appBaseUrl(): string {
  const configured = process.env.APP_URL ?? process.env.AUTH_URL;
  if (configured) return configured.replace(/\/+$/, "");
  if (process.env.NODE_ENV === "production") {
    throw new Error("Set APP_URL (or AUTH_URL): links in emails must never be built from a request's Host header.");
  }
  return "http://localhost:3000";
}
