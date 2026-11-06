import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({ name: "http-check", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(process.argv[2])));
console.log(client.getServerVersion());
const { tools } = await client.listTools();
console.log(tools.map((tool) => [tool.name, tool.annotations]));
const refused = await client.callTool({ name: "read_capture", arguments: { url: "https://example.com/a.png" } });
console.log(refused.isError, refused.content[0].text);
if (process.argv[3]) {
  const { content, isError } = await client.callTool({ name: "read_capture", arguments: { url: process.argv[3] } });
  console.log({ isError: isError ?? false, type: content[0].type, mimeType: content[0].mimeType, base64: content[0].data?.length, text: content[0].text });
}
await client.close();
