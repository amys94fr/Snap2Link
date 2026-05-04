# PR automation

Snap2Link uses a two-layer automation pipeline so most PRs are handled
without human or Claude attention. This document explains what runs where
so future-you (or a contributor) can debug it when something goes wrong.

## Layer 1 — GitHub Actions auto-merge (always-on)

**File:** [`.github/workflows/auto-merge.yml`](../.github/workflows/auto-merge.yml)

Triggers on every Dependabot PR (`opened`, `synchronize`, `reopened`,
`ready_for_review`). Reads the PR's metadata via
[`dependabot/fetch-metadata`](https://github.com/dependabot/fetch-metadata)
and acts on the `update-type` field:

| `update-type`                   | Action |
| ------------------------------- | ------ |
| `version-update:semver-patch`   | `gh pr merge --auto --squash --delete-branch` (waits for Tests workflow → merges) |
| `version-update:semver-minor`   | same as patch |
| `version-update:semver-major`   | drops a comment explaining auto-merge is disabled, leaves PR open for review |

Non-Dependabot PRs are ignored — humans always go through review.

### Repo settings the workflow assumes

These were enabled via `gh api PATCH repos/amys94fr/Snap2Link`:

- `allow_auto_merge: true` — required for `--auto` to queue the merge
- `delete_branch_on_merge: true` — keeps the repo clean
- `allow_squash_merge: true` — already on by default

### Why patch + minor only

Semver-patch and semver-minor cannot, by definition, introduce breaking
changes — only fixes and additive features. We've trusted the Tests
workflow (frontend Vitest + backend `cargo test --lib`) to catch any
regression in 99% of cases.

Majors are where real breakage lives — last week's batch had Tailwind 4
(PostCSS plugin split), TypeScript 6 (peer dep conflict with
`react-i18next@15`), and reqwest 0.13 (renamed `rustls-tls` feature).
None of those would have been safe to auto-merge.

## Layer 2 — Claude triage cron (opportunistic)

While Claude Code is running, a recurring job fires every 4 hours
(at :23 of the hour) and runs the triage prompt below. The cron lives
in-process — it doesn't fire when Claude is closed, and it auto-expires
after 7 days. Re-create it with `CronCreate` if it disappears.

### What the cron handles

Anything Layer 1 can't:

- **Major Dependabot bumps** — investigate the failure log, decide
  merge / close / leave-pending. Common closes: peer dep conflicts
  (`react-i18next` pinning TS to `^5`, etc.).
- **Human PRs** — never auto-merged. Cron writes a mini-review
  (changes, risks) so the maintainer can act when they're back.
- **winget-pkgs PR follow-up** — checks the latest open PR on
  `microsoft/winget-pkgs` to see if it merged.
- **Status digest** — short report ("RAS" or a punch list) shown in
  the Claude Code transcript.

### The prompt itself

Lives only in the cron — see `CronList` while Claude is running. Edit
by deleting the existing job (`CronDelete <id>`) and re-creating it
with `CronCreate`.

## Layer 3 — Notifications (built-in, always-on)

The maintainer already gets PR notifications via:

- **GitHub email notifications** — subscribed by default to the repo
- **GitHub mobile push** — install the GitHub app, enable PR pings
- **Repo watch settings** — set to "All Activity" gives every event

No extra wiring needed. Layer 1 already handles 90% of incoming PRs
silently, so notifications mostly mean "something needs your attention"
rather than "noise from Dependabot."

## Runbook — when something goes wrong

### "Auto-merge isn't firing"

1. Check the workflow run: `gh run list --repo amys94fr/Snap2Link --workflow auto-merge.yml`
2. Confirm repo setting: `gh api repos/amys94fr/Snap2Link --jq .allow_auto_merge` should be `true`
3. Confirm the PR is from `dependabot[bot]` and the bump is `patch` / `minor`
4. Read the workflow log — the `dependabot/fetch-metadata` action sometimes can't classify a bump if the dependency uses non-semver tags

### "Claude cron isn't running"

1. `CronList` to confirm the job is alive
2. Cron only fires while the REPL is idle — if you're mid-conversation, it waits
3. After 7 days the recurring job auto-expires; recreate with `CronCreate`
4. The cron is session-only; if you restart Claude Code, recreate it

### "A major bump kept getting recreated by Dependabot"

Comment `@dependabot ignore this major version` on the PR (or close it
with that comment in the body). Dependabot won't recreate it for that
version range. The next major after that one will still be proposed.

## Why not GitHub Actions all the way?

We considered fully replacing the Claude cron with another GitHub
Actions workflow that handles majors too. The blocker is judgment —
e.g., when TS6 failed because `react-i18next@15` pinned it to `^5`, the
right call was to wait for `react-i18next@17` (which broadened the peer
to `^5 || ^6`). A pure CI workflow can't reason about peer deps across
the npm graph. Claude can. So Layer 2 stays opportunistic and Layer 1
handles the boring stuff.
