import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

import { SERVER_VERSION, answer, type ToolResult } from "./protocol";

const SHOWN: ToolResult = { content: [{ type: "text", text: "shown" }] };
const ask = (message: object) => answer(JSON.stringify(message), async () => SHOWN);
const request = (method: string, params?: object) => ask({ jsonrpc: "2.0", id: 1, method, params });

describe("answer", () => {
  it("keeps a protocol version it knows", async () => {
    const reply = await request("initialize", { protocolVersion: "2025-06-18" });
    expect(reply).toMatchObject({ result: { protocolVersion: "2025-06-18" } });
  });

  it("offers its latest version for one it doesn't know", async () => {
    const reply = await request("initialize", { protocolVersion: "1999-01-01" });
    expect(reply).toMatchObject({ result: { protocolVersion: "2025-11-25" } });
  });

  it("doesn't answer notifications", async () => {
    expect(await ask({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
  });

  it("answers ping", async () => {
    expect(await request("ping")).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });

  it("calls the tool with the link", async () => {
    const seen: string[] = [];
    const line = JSON.stringify({
      id: 1,
      method: "tools/call",
      params: { name: "read_capture", arguments: { url: "https://i.snap2link.app/abc" } },
    });
    const reply = await answer(line, async (url) => {
      seen.push(url);
      return SHOWN;
    });
    expect(seen).toEqual(["https://i.snap2link.app/abc"]);
    expect(reply).toMatchObject({ id: 1, result: SHOWN });
  });

  it.each([
    ["an unknown method", "resources/list", undefined, -32601],
    ["an unknown tool", "tools/call", { name: "other", arguments: {} }, -32602],
    ["a missing link", "tools/call", { name: "read_capture", arguments: {} }, -32602],
    ["a link that isn't text", "tools/call", { name: "read_capture", arguments: { url: 1 } }, -32602],
  ])("refuses %s", async (_, method, params, code) => {
    expect(await request(method, params)).toMatchObject({ id: 1, error: { code } });
  });

  it("refuses what isn't JSON", async () => {
    expect(await answer("{", async () => SHOWN)).toMatchObject({ id: null, error: { code: -32700 } });
  });

  it("refuses JSON that isn't a message", async () => {
    expect(await answer("[1]", async () => SHOWN)).toMatchObject({ error: { code: -32600 } });
  });
});

describe("the shipped server, with the official client", () => {
  async function connected() {
    const client = new Client({ name: "test", version: "1.0.0" });
    const server = fileURLToPath(new URL("../snap2link-mcp.mjs", import.meta.url));
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [server] }));
    return client;
  }

  it("introduces itself and lists its tool", async () => {
    const client = await connected();
    expect(client.getServerVersion()).toEqual({ name: "snap2link", version: SERVER_VERSION });
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["read_capture"]);
    expect(tools[0].annotations?.readOnlyHint).toBe(true);
    await client.close();
  });

  it("refuses a link that isn't Snap2Link's without any download", async () => {
    const client = await connected();
    const result = await client.callTool({
      name: "read_capture",
      arguments: { url: "https://example.com/capture.png" },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("Not a Snap2Link link");
    await client.close();
  });
});
