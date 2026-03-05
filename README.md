# announce-release

A reusable GitHub composite action that enriches release notes using Claude and posts a structured Slack announcement.

## What it does

1. **Collects PRs** — walks all commits between the previous and current tag, finding the associated PR for each
2. **Fetches diffs** — retrieves filtered per-file diffs (lockfiles, dist output, and snapshots are excluded)
3. **Resolves issue reporters** — parses `Closes #123` references, fetches the reporter's GitHub username, and maps it to a Slack member ID via `usernames.yml`
4. **Enriches with Claude** — sends PR metadata to Claude and receives structured JSON summaries with a type (`feat`, `fix`, `chore`, `breaking`) and a consumer-facing sentence per PR
5. **Posts to Slack** — builds a Block Kit payload with the enriched changelog, install instructions, and `@mentions` for any issue reporters found in the mappings

## Usage

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
          package-name: '@your-org/your-package'
          registry-url: 'https://your-registry/@your-org/your-package'
          slack-channel: 'your-channel'
          slack-channel-id: 'C12AB34CD'
```

> `fetch-depth: 0` is required so that `git describe` can walk back to find the previous tag.

## Inputs

| Input | Required | Description |
|---|---|---|
| `anthropic-api-key` | Yes | Anthropic API key |
| `slack-webhook-url` | Yes | Slack incoming webhook URL |
| `release-tag` | Yes | Release tag (e.g. `v1.2.0`) |
| `release-url` | Yes | URL to the GitHub release page |
| `package-name` | Yes | NPM package name shown in the Slack message |
| `registry-url` | No | URL to the package in your private registry |
| `slack-channel` | No | Channel name for the footer link |
| `slack-channel-id` | No | Channel ID for the footer link |

## Username mappings

`usernames.yml` maps GitHub usernames to Slack member IDs so that issue reporters can be `@mentioned` in the Slack announcement.

```yaml
usernames:
  githubusername: USLACKID
```

Slack member IDs can be found by clicking a user's profile > **...** > **Copy member ID**.

## Secrets

`ANTHROPIC_API_KEY` and `SLACK_WEBHOOK_URL` can be set at org level so all consuming repos inherit them without individual configuration.
