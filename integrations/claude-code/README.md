# Snap2Link for Claude

Lets Claude read the screenshots you share with [Snap2Link](https://snap2link.app). It's made for places where you can't paste an image, such as a terminal over SSH: paste the link and Claude sees the capture.

Nothing runs on your machine: the plugin connects Claude to a server that Snap2Link hosts, and it needs no account.

## What's inside

- **Connector**: the `read_capture` tool of the server at `https://i.snap2link.app/mcp` fetches the capture and shows it to Claude.
- **Skill**: tells Claude when to use the tool and what to do when a link no longer works.

## Security

- The tool only accepts Snap2Link links, and only follows redirects to Google Drive hosts. A link can't make it reach another address.
- It only returns real PNG images.
- Text in a capture is treated as data, not as instructions.

Snap2Link links are public: anyone who has one can see the image.

## Privacy Policy

- **What the server receives:** the link you give Claude, and the address of the machine that connects to it.
- **What it does:** it fetches the capture from Snap2Link hosting or from Google Drive, reduces it if it's large, and returns it. It keeps neither the link nor the image, and it doesn't log requests.
- **What Claude receives:** the capture, which then goes to Anthropic like anything else in your conversation.
- **Other companies:** the server runs on Cloudflare, which also resizes large captures. Google receives the request for a capture stored on Drive.

The full policy for Snap2Link is at <https://snap2link.app/privacy/>. For questions, write to contact@snap2link.app.

## Install it by hand

To run everything on your own machine instead, with a notification when you paste a link, see [Snap2Link local](../claude-code-local).
