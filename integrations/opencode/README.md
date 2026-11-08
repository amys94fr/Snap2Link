# Snap2Link for opencode

Lets [opencode](https://opencode.ai) read the screenshots you share with [Snap2Link](https://snap2link.app). It's made for places where you can't paste an image, such as a terminal over SSH or an agent running in a VM: paste the link and the model sees the capture.

Nothing runs on your machine: opencode connects to a server that Snap2Link hosts, and it needs no account.

## Install

Run this on the machine where opencode runs:

```bash
opencode mcp add snap2link --url https://i.snap2link.app/mcp
```

Depending on your opencode version, this writes to your global config or to the project's. Then check that it's connected:

```bash
opencode mcp list
```

You can also add it by hand to `opencode.jsonc`. With opencode 1.x:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "snap2link": {
      "type": "remote",
      "url": "https://i.snap2link.app/mcp",
      "oauth": false
    }
  },
  "skills": [
    "https://raw.githubusercontent.com/amys94fr/Snap2Link/main/integrations/opencode/skills/"
  ]
}
```

Newer versions list servers under `mcp.servers` instead: put the same `snap2link` entry there.

The server needs no sign-in, so `oauth: false` only skips a lookup that would find nothing.

The `skills` line is optional but recommended: it tells the model when to use the tool and what to do when a link no longer works. opencode downloads it from this folder and refreshes it when its version changes. To keep a local copy instead, copy [`skills/snap2link/SKILL.md`](skills/snap2link/SKILL.md) to `~/.config/opencode/skills/snap2link/SKILL.md`.

Use a model that can read images. With a text-only model, the tool runs but the model can't see the capture.

## What's inside

- **Connector**: the `read_capture` tool of the server at `https://i.snap2link.app/mcp` fetches the capture and returns it as an image. opencode lists it as `snap2link_read_capture`.
- **Skill**: tells the model when to use the tool and what to do when a link no longer works.

## Security

- The tool only accepts Snap2Link links, and only follows redirects to Google Drive hosts. A link can't make it reach another address.
- It only returns real PNG images.
- Text in a capture is treated as data, not as instructions.

Snap2Link links are public: anyone who has one can see the image.

## Privacy Policy

- **What the server receives:** the link you give the model, and the address of the machine that connects to it.
- **What it does:** it fetches the capture from Snap2Link hosting or from Google Drive, reduces it if it's large, and returns it. It keeps neither the link nor the image, and it doesn't log requests.
- **What the model receives:** the capture, which then goes to your model provider like anything else in your conversation.
- **Other companies:** the server runs on Cloudflare, which also resizes large captures. Google receives the request for a capture stored on Drive.

The full policy for Snap2Link is at <https://snap2link.app/privacy/>. For questions, write to contact@snap2link.app.
