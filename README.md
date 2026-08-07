# announce-please

A reusable GitHub composite action that enriches release notes using Claude and posts a structured Slack and/or Discord announcement.

## What it does

1. **Collects PRs** — walks all commits between the previous and current tag, finding the associated PR for each
2. **Fetches diffs** — retrieves filtered per-file diffs (lockfiles, dist output, and snapshots are excluded)
3. **Resolves issue reporters** — parses `Closes #123` references, fetches the reporter's GitHub username, and maps it to a Slack member ID and/or Discord user ID via the `slack-username-mappings` / `discord-username-mappings` inputs
4. **Enriches with Claude** — sends PR metadata to Claude and receives structured JSON summaries with a type, category, and consumer-facing sentence per PR
5. **Posts to Slack and/or Discord** — builds a Slack Block Kit payload and/or a Discord embed grouping changes by category (alphabetically), with a miscellaneous section for uncategorised changes. Items within each group are sorted by number of files changed so larger PRs surface first. Provide either webhook, or both to post to both platforms for the same release

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
      - uses: robertlyall/announce-please@v1
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          slack-webhook-url: ${{ secrets.SLACK_WEBHOOK_URL }}
          discord-webhook-url: ${{ secrets.DISCORD_WEBHOOK_URL }}
          release-tag: ${{ needs.release-please.outputs.tag_name }}
          release-url: ${{ needs.release-please.outputs.html_url }}
          package-name: '@your-org/your-package'
          project-description: 'A React component library for internal dashboards'
          target-audience: 'frontend developers consuming the component library'
          registry-url: 'https://your-registry/@your-org/your-package'
          slack-channel: 'your-channel'
          slack-channel-id: 'C12AB34CD'
          discord-channel-id: '123456789012345678'
          slack-username-mappings: |
            githubuser:U02KMF293
            anotheruser:U05ABCD123
          discord-username-mappings: |
            githubuser:189754215833812992
            anotheruser:220133918021812224
```

> `fetch-depth: 0` is required so that `git describe` can walk back to find the previous tag.
>
> At least one of `slack-webhook-url` or `discord-webhook-url` must be set; provide both to
> post to both platforms for the same release.

## Inputs

### Required

| Input | Description |
|---|---|
| `anthropic-api-key` | Anthropic API key |
| `package-name` | Package or project name shown in the announcement |
| `release-tag` | Release tag (e.g. `v1.2.0`) |
| `release-url` | URL to the GitHub release page |

At least one of `slack-webhook-url` or `discord-webhook-url` (below) must also be set.

### Optional

| Input | Description |
|---|---|
| `slack-webhook-url` | Slack incoming webhook URL |
| `discord-webhook-url` | Discord incoming webhook URL |
| `project-description` | Project description injected into the Claude prompt for more accurate summaries |
| `registry-url` | URL to the package in your private registry |
| `slack-channel` | Slack channel name for the footer link |
| `slack-channel-id` | Slack channel ID for the footer link |
| `discord-channel-id` | Discord channel ID for the footer link |
| `claude-model` | Claude model ID to use for enrichment (default: `claude-sonnet-4-6`) |
| `target-audience` | Describes who the release notes are written for, controlling tone and detail level (default: `developers who consume or depend on this project`) |
| `slack-username-mappings` | Newline-separated `github_username:SLACK_ID` pairs for @mentioning issue reporters in Slack |
| `discord-username-mappings` | Newline-separated `github_username:DISCORD_ID` pairs for @mentioning issue reporters in Discord |
| `username-mappings` | Deprecated alias for `slack-username-mappings`, kept for backwards compatibility. Ignored if `slack-username-mappings` is set |

## Username mappings

The `slack-username-mappings` and `discord-username-mappings` inputs map GitHub usernames
to Slack member IDs / Discord user IDs so that issue reporters can be `@mentioned` in the
announcement. Pass newline-separated `github_username:ID` pairs, one input per platform:

```yaml
slack-username-mappings: |
  robertlyall:U02KMF293
  someoneelse:U05ABCD123
discord-username-mappings: |
  robertlyall:189754215833812992
  someoneelse:220133918021812224
```

Each is independent — you can configure one, both, or neither. When both are omitted, issue
scanning and mention resolution are skipped entirely.

Slack member IDs can be found by clicking a user's profile > **...** > **Copy member ID**.
Discord user IDs can be found by enabling Developer Mode (User Settings > Advanced), then
right-clicking a user > **Copy User ID**.

> `username-mappings` (no platform prefix) still works as a legacy alias for
> `slack-username-mappings` — existing workflows using it don't need to change anything.

## Changelog grouping

The Slack and Discord messages group changelog items by category, then by type:

1. **Category groups** — PRs tied to a specific category (e.g. a component, module, or endpoint) are grouped under an alphabetically sorted heading
2. **Miscellaneous** — PRs not tied to a specific category fall under a single "Miscellaneous" heading, sorted by type

Supported types and their emojis:

| Type | Emoji | Description |
|---|---|---|
| `breaking` | ⚠️ | Breaking changes |
| `feat` | ✨ | New features |
| `fix` | 🐛 | Bug fixes |
| `perf` | ⚡ | Performance improvements |
| `refactor` | ♻️ | Refactoring |
| `docs` | 📚 | Documentation |
| `chore` | 🔧 | Maintenance (also covers `ci`, `test`, `build`, `style`) |

## Permissions

The action uses the automatic `GITHUB_TOKEN` provided by GitHub Actions to access the
repository API (comparing tags, fetching PRs, diffs, and issues). No additional token
configuration is required.

The workflow must have at least the following
[permissions](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/controlling-permissions-for-github_token):

```yaml
permissions:
  contents: read
  pull-requests: read
  issues: read
```

> `issues: read` is only needed if your PRs reference issues via `Closes #123` for
> reporter mentions. The action will still work without it, but mention lookups will
> be skipped.

## Secrets

`ANTHROPIC_API_KEY`, `SLACK_WEBHOOK_URL`, and `DISCORD_WEBHOOK_URL` can be set at org level so all consuming repos inherit them without individual configuration.
