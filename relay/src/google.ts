/**
 * Checks a Google ID token. The app gets it from Google and hands it over, so
 * nothing in it counts until the signature matches Google's published keys.
 */

const CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const CERTS_LIFETIME_MS = 60 * 60 * 1000;

/** An ID token lasts an hour. A sign-in only needs it for a few seconds. */
const MAX_TOKEN_AGE_S = 10 * 60;
const CLOCK_SKEW_S = 60;

interface GoogleKey extends JsonWebKey {
  kid: string;
}

interface Claims {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  iat?: unknown;
  email?: unknown;
  email_verified?: unknown;
}

/** Google rotates its keys every few days: fetched again on an unknown one. */
let certs: { keys: GoogleKey[]; fetchedAt: number } | null = null;

async function googleKey(kid: string, now: number): Promise<GoogleKey | null> {
  const known = () => certs?.keys.find((key) => key.kid === kid) ?? null;
  if (certs && now - certs.fetchedAt < CERTS_LIFETIME_MS && known()) return known();

  const answer = await fetch(CERTS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!answer.ok) throw new Error(`google certs: ${answer.status}`);
  const { keys } = await answer.json<{ keys: GoogleKey[] }>();
  certs = { keys, fetchedAt: now };
  return known();
}

function decoded(part: string): Uint8Array<ArrayBuffer> {
  const base64 = part.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

const json = <T>(part: string): T => JSON.parse(new TextDecoder().decode(decoded(part))) as T;

export type GoogleResult = { email: string } | "refused" | "unavailable";

/** The address Google vouches for, when this token was made for one of `clientIds`. */
export async function verifiedGoogleEmail(
  token: string,
  clientIds: readonly string[],
  now: number,
): Promise<GoogleResult> {
  const parts = token.split(".");
  if (parts.length !== 3) return "refused";
  const [head, body, signature] = parts;

  let header: { alg?: unknown; kid?: unknown };
  let claims: Claims;
  let signed: Uint8Array<ArrayBuffer>;
  try {
    header = json(head);
    claims = json(body);
    signed = decoded(signature);
  } catch {
    return "refused";
  }
  // The algorithm is fixed here: a token must not get to choose how it is checked.
  if (header.alg !== "RS256" || typeof header.kid !== "string") return "refused";

  let key: GoogleKey | null;
  try {
    key = await googleKey(header.kid, now);
  } catch {
    return "unavailable";
  }
  if (!key) return "refused";

  const algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
  const publicKey = await crypto.subtle.importKey("jwk", key, algorithm, false, ["verify"]);
  const content = new TextEncoder().encode(`${head}.${body}`);
  if (!(await crypto.subtle.verify(algorithm, publicKey, signed, content))) return "refused";

  const seconds = now / 1000;
  const fresh =
    typeof claims.exp === "number" &&
    typeof claims.iat === "number" &&
    claims.exp > seconds &&
    claims.iat <= seconds + CLOCK_SKEW_S &&
    claims.iat >= seconds - MAX_TOKEN_AGE_S;
  const ours = clientIds.includes(String(claims.aud)) && ISSUERS.includes(String(claims.iss));
  if (!fresh || !ours) return "refused";

  if (claims.email_verified !== true || typeof claims.email !== "string") return "refused";
  return { email: claims.email };
}
