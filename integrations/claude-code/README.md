# Snap2Link for Claude Code

Lets Claude Code read the screenshots you share with [Snap2Link](https://snap2link.app). It's made for machines where you can't paste an image, such as a terminal over SSH: paste the link and Claude sees the capture.

## Install

Type this at the Claude Code prompt:

```text
/plugin install snap2link --marketplace amys94fr/Snap2Link
```

It needs Node.js 20 or newer on the machine where Claude Code runs. Snap2Link itself stays on your desktop.

## What's inside

- **MCP server**: the `read_capture` tool downloads the capture and shows it to Claude.
- **Skill**: tells Claude when to use the tool and what to do when a link no longer works.
- **Mod**: spots a Snap2Link link in your prompt, shows a notification and tells Claude to read it. It needs a recent Claude Code, and the rest works without it.

## Security

- The tool only accepts Snap2Link links, and only follows redirects to Google Drive hosts. Links on `i.snap2link.app` are never redirected. A link can't make it reach another address or your local network.
- It keeps a file only if it's a real PNG of 50 MB at most.
- Text in a capture is treated as data, not as instructions.

Snap2Link links are public: anyone who has one can see the image.

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
claude plugin test .
```

`server/snap2link-mcp.mjs` is the bundle the plugin ships, so users don't have to install dependencies. Run `pnpm build` after changing the server: CI fails if the bundle doesn't match the source.
