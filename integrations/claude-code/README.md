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
- **Mod**: spots a Snap2Link link in your prompt, shows a notification and tells Claude to read it. It hooks `prompt.submit` only: it reads the text you send, adds that note when it finds a link and changes nothing else. It needs a recent Claude Code, and the rest works without it.

## Security

- The tool only accepts Snap2Link links, and only follows redirects to Google Drive hosts. Links on `i.snap2link.app` are never redirected. A link can't make it reach another address or your local network.
- It keeps a file only if it's a real PNG of 50 MB at most.
- Text in a capture is treated as data, not as instructions.

Snap2Link links are public: anyone who has one can see the image.

## Privacy Policy

The plugin has no account, no analytics and no server of its own. It runs on your machine.

- **What it collects:** nothing. It only reads the link you give it.
- **Where it connects:** to `i.snap2link.app` or to Google Drive, to download the capture. That host sees your IP address, as with any download.
- **What Claude receives:** the capture, which then goes to Anthropic like anything else in your conversation.
- **What stays on your machine:** a capture over 3.5 MB is saved in your temporary folder, readable only by you, so that Claude can open it. The plugin doesn't delete that file.

The full policy for Snap2Link is at <https://snap2link.app/privacy>. For questions, write to contact@snap2link.app.

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
claude plugin test .
```

`server/snap2link-mcp.mjs` is the file the plugin ships. It has no dependencies and isn't minified, so you can read what runs. Run `pnpm build` after changing the server: CI fails if the bundle doesn't match the source.
