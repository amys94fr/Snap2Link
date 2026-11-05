import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { downloadCapture } from "./capture";
import { answer, type ToolResult } from "./protocol";

// Past this size the base64 image no longer fits in a tool result, so the
// capture goes to a file that the Read tool can resize.
const MAX_INLINE_BYTES = 3.5 * 1024 * 1024;

async function saveCapture(bytes: Uint8Array): Promise<string> {
  // mkdtemp creates the folder as 0700 and writeFile the capture as 0600:
  // a capture can show anything that was on screen.
  const folder = await mkdtemp(join(tmpdir(), "snap2link-"));
  const path = join(folder, "capture.png");
  await writeFile(path, bytes, { mode: 0o600, flag: "wx" });
  return path;
}

async function readCapture(url: string): Promise<ToolResult> {
  try {
    const bytes = await downloadCapture(url);
    if (bytes.byteLength > MAX_INLINE_BYTES) {
      const path = await saveCapture(bytes);
      return { content: [{ type: "text", text: `The capture is large. Open it with the Read tool: ${path}` }] };
    }
    const data = Buffer.from(bytes).toString("base64");
    return { content: [{ type: "image", data, mimeType: "image/png" }] };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text }], isError: true };
  }
}

// MCP over stdio: one JSON message per line, in both directions.
createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", async (line) => {
  const response = await answer(line, readCapture);
  if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
});
