# announce-release

A reusable GitHub composite action (`robertlyall/announce-release`) that intercepts Release Please output, enriches the changelog using Claude, and posts a structured Slack announcement.

## What it does

1. **Collects PRs** — on a new release, walks all commits between the previous and current tag via the GitHub API, finding the associated PR for each
2. **Fetches diffs** — retrieves filtered per-file diffs for each PR (lockfiles, dist output, and snapshots are excluded)
3. **Resolves issue reporters** — parses `Closes #123` references from PR bodies, fetches the issue reporter's GitHub username, and maps it to a Slack member ID via `usernames.yml`
4. **Enriches with Claude** — sends PR metadata (commit message, title, body, labels, diff) to `claude-sonnet-4-20250514` and receives structured JSON summaries with a type (`feat`, `fix`, `chore`, `breaking`) and a consumer-facing sentence per PR
5. **Posts to Slack** — builds a Block Kit payload with the enriched changelog, install instructions, and `@mentions` for any issue reporters found in the mappings

## Repository structure

```
action.yml              — composite action definition and inputs
prompt.md               — system prompt fed to Claude for enrichment
release.yml             — example Release Please + announce workflow
usernames.yml           — GitHub username → Slack member ID mappings
scripts/
  enrich.mjs            — GitHub API + Claude enrichment logic
  slack.mjs             — Slack Block Kit payload builder and poster
```

## Inputs

| Input | Required | Description |
|---|---|---|
| `anthropic-api-key` | ✅ | Anthropic API key |
| `slack-webhook-url` | ✅ | Slack incoming webhook URL |
| `release-tag` | ✅ | Release tag (e.g. `v1.2.0`) |
| `release-url` | ✅ | URL to the GitHub release page |
| `package-name` | ✅ | NPM package name shown in the Slack message |
| `registry-url` | — | URL to the package in your private registry |
| `slack-channel` | — | Channel name for the footer link |
| `slack-channel-id` | — | Channel ID for the footer link |

## Username mappings

`usernames.yml` maps GitHub usernames to Slack member IDs. It lives centrally in this repo so there is one place to maintain it across all consuming projects.

```yaml
usernames:
  githubusername: USLACKID
```

Slack member IDs can be found by clicking a user's profile → **⋯** → **Copy member ID**.

## Usage in a consuming repo

```yaml
jobs:
  release-please:
    # ...
    outputs:
      release_created: ${{ steps.release.outputs.release_created }}
      tag_name: ${{ steps.release.outputs.tag_name }}
      html_url: ${{ steps.release.outputs.html_url }}

  announce:
    needs: release-please
    if: ${{ needs.release-please.outputs.release_created == 'true' }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: robertlyall/announce-release@v1
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          slack-webhook-url: ${{ secrets.SLACK_WEBHOOK_URL }}
          release-tag: ${{ needs.release-please.outputs.tag_name }}
          release-url: ${{ needs.release-please.outputs.html_url }}
          package-name: '@krystal/your-package'
          registry-url: 'https://your-registry/@krystal/your-package'
          slack-channel: 'your-channel'
          slack-channel-id: 'C12AB34CD'
```

`fetch-depth: 0` is required on the checkout step so that `git describe` can walk back to find the previous tag.

## Secrets

`ANTHROPIC_API_KEY` and `SLACK_WEBHOOK_URL` can be set at org level so all consuming repos inherit them without individual configuration.

## Versioning

Tag releases of this action (e.g. `v1`, `v1.2.0`) so consuming repos can pin to a stable version and opt in to updates deliberately.
