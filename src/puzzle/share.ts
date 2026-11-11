// ── Share links ──
// Sandbox code shared by link: the Share button stores the code as shares/{id} (src/firebase/shares.ts), and the
// link is the site's address with ?s={id}, which opens the sandbox with that code.

/** A share's id: 8 characters of [0-9A-Za-z] (about 48 bits), so that nobody finds shares by guessing. */
export const SHARE_ID_LENGTH = 8;
/** The most code a share holds (firestore.rules allows no more). */
export const MAX_SHARE_CHARS = 50_000;

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const SHARE_PARAM = 's';

export function isShareId(id: string): boolean {
  return /^[0-9A-Za-z]{8}$/.test(id);
}

/** A new random share id, from `randomBytes` (by default the browser's cryptographic random numbers). */
export function newShareId(randomBytes: (n: number) => Uint8Array = n => crypto.getRandomValues(new Uint8Array(n))): string {
  let id = '';
  while (id.length < SHARE_ID_LENGTH) {
    for (const b of randomBytes(SHARE_ID_LENGTH * 2)) {
      // 248 is 4 × 62: the bytes above it are dropped, so that every character is as likely
      if (b < 248 && id.length < SHARE_ID_LENGTH) id += ALPHABET[b % 62];
    }
  }
  return id;
}

/** The link to a share: the page's address with ?s={id} (and no #fragment). */
export function shareLink(page: string, id: string): string {
  const url = new URL(page);
  url.searchParams.set(SHARE_PARAM, id);
  url.hash = '';
  return url.toString();
}

/** The ?s= of a page's address (which may not be a share id), or null when it has none. */
export function shareParam(page: string): string | null {
  return new URL(page).searchParams.get(SHARE_PARAM);
}

/** The page's address without a share in it. */
export function withoutShare(page: string): string {
  const url = new URL(page);
  url.searchParams.delete(SHARE_PARAM);
  // Older browsers leave a bare ? behind
  if (!url.search) url.search = '';
  return url.toString();
}
