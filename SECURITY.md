# Security policy

## Supported versions

Only the latest released version of Snap2Link receives security fixes. Older versions are not patched — please upgrade to the latest installer or use the in-app updater (Settings → Check for Updates).

| Version | Supported |
|---|---|
| 1.0.x | ✅ |
| < 1.0.0 | ❌ |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.** Doing so puts every Snap2Link user at risk during the time it takes to investigate and ship a fix.

Use one of these private channels instead:

1. **Preferred — [open a private security advisory on GitHub](https://github.com/amys94fr/Snap2Link/security/advisories/new).** This creates a private discussion thread where we can collaborate on the fix and coordinate disclosure.
2. Alternatively, email **amys94fr@gmail.com** with the subject line `[Snap2Link Security]`. Encrypted email welcome — let me know in plaintext that you want to switch and I'll send a public key.

Please include:

- A clear description of the vulnerability and its impact
- Steps to reproduce (or a proof of concept) — minimal repro is best
- The version of Snap2Link affected
- Any suggested mitigation, if you have one in mind

## What to expect

- **Acknowledgement within 72 hours** of receipt.
- An initial assessment (severity, affected scope, fix complexity) within 7 days.
- A patch released as soon as a fix is ready and reviewed; for high-severity issues this is usually within 14 days.
- Credit in the release notes and the advisory, unless you'd rather stay anonymous.

## Scope

In scope:

- The Snap2Link desktop application binary
- The Tauri backend (Rust crates in `src-tauri/`)
- The frontend code shipped in the installer (React/TypeScript)
- The auto-update mechanism (signature validation, manifest verification)
- The OAuth flow and how tokens are stored on disk

Out of scope:

- Vulnerabilities in upstream dependencies that are publicly known but not yet patched in our pinned versions — please report those upstream first
- Issues that require a malicious local user with full admin access to the user's machine (the threat model assumes the user controls their device)
- Social engineering of the user (e.g. phishing pages that mimic the OAuth wizard)

Thanks for helping keep Snap2Link users safe.
