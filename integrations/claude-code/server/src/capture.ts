const SHARE_LINK = /^https:\/\/drive\.google\.com\/uc\?id=[A-Za-z0-9_-]{1,128}&export=download$/;
const RELAY_LINK = /^https:\/\/i\.snap2link\.app\/[0-9A-Za-z]{22}(\.png)?$/;
const DOWNLOAD_HOSTS = new Set(["drive.google.com", "drive.usercontent.google.com"]);
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 30_000;

// Same ceiling as MAX_CAPTURE_BYTES in the desktop app.
export const MAX_CAPTURE_BYTES = 50 * 1024 * 1024;

export function isShareLink(url: string): boolean {
  return SHARE_LINK.test(url) || RELAY_LINK.test(url);
}

function isPng(bytes: Uint8Array): boolean {
  return PNG_MAGIC.every((byte, index) => bytes[index] === byte);
}

function nextHop(response: Response, from: string): string {
  const location = response.headers.get("location");
  if (!location) throw new Error("The host sent a redirect with no target.");
  const target = new URL(location, from);
  if (target.protocol !== "https:" || !DOWNLOAD_HOSTS.has(target.hostname)) {
    throw new Error(`Refused a redirect to ${target.hostname}: not a Google Drive host.`);
  }
  return target.href;
}

async function readCapped(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_CAPTURE_BYTES) throw new Error("This file is too large to be a capture.");
  if (!response.body) throw new Error("The host sent an empty response.");

  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > MAX_CAPTURE_BYTES) throw new Error("This file is too large to be a capture.");
    chunks.push(chunk);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Downloads a Snap2Link capture. Only a Snap2Link link is accepted and only
 * Google Drive hosts are followed, so a link can't point this at anything else.
 * The relay never redirects.
 */
export async function downloadCapture(link: string, fetcher: typeof fetch = fetch): Promise<Uint8Array> {
  if (!isShareLink(link)) {
    throw new Error(
      "Not a Snap2Link link: expected https://i.snap2link.app/... or https://drive.google.com/uc?id=...&export=download",
    );
  }

  let url = link;
  for (let hops = 0; hops <= MAX_REDIRECTS; hops += 1) {
    const response = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });

    if (response.status >= 300 && response.status < 400) {
      url = nextHop(response, url);
      continue;
    }
    if (!response.ok) {
      throw new Error(`The host answered ${response.status}. The capture may have been deleted or expired.`);
    }

    const bytes = await readCapped(response);
    if (!isPng(bytes)) {
      throw new Error("This link is not a PNG image. The capture may have been deleted or is no longer public.");
    }
    return bytes;
  }
  throw new Error("Too many redirects.");
}
