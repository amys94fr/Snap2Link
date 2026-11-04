import { describe, expect, it } from "vitest";

import { MAX_CAPTURE_BYTES, downloadCapture, isShareLink } from "./capture";

const LINK = "https://drive.google.com/uc?id=abc_123-XYZ&export=download";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const redirectTo = (location: string) => new Response(null, { status: 303, headers: { location } });

function fetcherOf(...responses: Response[]) {
  const urls: string[] = [];
  const fetcher = (async (input: Parameters<typeof fetch>[0]) => {
    urls.push(String(input));
    const response = responses.shift();
    if (!response) throw new Error("unexpected request");
    return response;
  }) as typeof fetch;
  return { fetcher, urls };
}

describe("isShareLink", () => {
  it("accepts the link the app generates", () => {
    expect(isShareLink(LINK)).toBe(true);
  });

  it.each([
    ["plain http", "http://drive.google.com/uc?id=abc&export=download"],
    ["another host", "https://evil.example/uc?id=abc&export=download"],
    ["a lookalike host", "https://drive.google.com.evil.example/uc?id=abc&export=download"],
    ["credentials in the URL", "https://drive.google.com@evil.example/uc?id=abc&export=download"],
    ["an extra parameter", `${LINK}&x=1`],
    ["a path in the id", "https://drive.google.com/uc?id=../abc&export=download"],
    ["a local address", "http://127.0.0.1/uc?id=abc&export=download"],
  ])("refuses %s", (_name, url) => {
    expect(isShareLink(url)).toBe(false);
  });
});

describe("downloadCapture", () => {
  it("makes no request for a link it refuses", async () => {
    const { fetcher, urls } = fetcherOf();
    await expect(downloadCapture("http://127.0.0.1/secret", fetcher)).rejects.toThrow("Not a Snap2Link link");
    expect(urls).toEqual([]);
  });

  it("follows Drive's redirect and returns the image", async () => {
    const target = "https://drive.usercontent.google.com/download?id=abc&export=download";
    const { fetcher, urls } = fetcherOf(redirectTo(target), new Response(PNG));

    await expect(downloadCapture(LINK, fetcher)).resolves.toEqual(PNG);
    expect(urls).toEqual([LINK, target]);
  });

  it.each([
    ["another host", "https://evil.example/capture.png"],
    ["a local address", "https://127.0.0.1/capture.png"],
    ["plain http", "http://drive.usercontent.google.com/capture.png"],
  ])("refuses a redirect to %s", async (_name, location) => {
    const { fetcher, urls } = fetcherOf(redirectTo(location));

    await expect(downloadCapture(LINK, fetcher)).rejects.toThrow("Refused a redirect");
    expect(urls).toEqual([LINK]);
  });

  it("stops after too many redirects", async () => {
    const hop = "https://drive.google.com/next";
    const { fetcher } = fetcherOf(...Array.from({ length: 6 }, () => redirectTo(hop)));

    await expect(downloadCapture(LINK, fetcher)).rejects.toThrow("Too many redirects");
  });

  it("refuses a page that is not a PNG", async () => {
    const { fetcher } = fetcherOf(new Response("<html>Sign in</html>"));

    await expect(downloadCapture(LINK, fetcher)).rejects.toThrow("not a PNG");
  });

  it("explains a deleted capture", async () => {
    const { fetcher } = fetcherOf(new Response(null, { status: 404 }));

    await expect(downloadCapture(LINK, fetcher)).rejects.toThrow("404");
  });

  it("refuses a file announced as too large", async () => {
    const headers = { "content-length": String(MAX_CAPTURE_BYTES + 1) };
    const { fetcher } = fetcherOf(new Response(PNG, { headers }));

    await expect(downloadCapture(LINK, fetcher)).rejects.toThrow("too large");
  });

  it("stops reading a file that turns out too large", async () => {
    const chunk = new Uint8Array(MAX_CAPTURE_BYTES / 2 + 1);
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const { fetcher } = fetcherOf(new Response(body));

    await expect(downloadCapture(LINK, fetcher)).rejects.toThrow("too large");
  });
});
