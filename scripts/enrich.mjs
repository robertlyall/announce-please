import { execSync } from "child_process";
import { appendFileSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const GITHUB_API = "https://api.github.com";
const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
const token = process.env.GITHUB_TOKEN;
const currentTag = process.env.RELEASE_TAG;

// ─── Helpers ──────────────────────────────────────────────────────────────

function setOutput(name, value) {
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function githubFetch(path) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status} — ${path}`);
  return res.json();
}

// ─── Username mappings ────────────────────────────────────────────────────

function parseUsernameMappings() {
  const raw = (process.env.USERNAME_MAPPINGS ?? "").trim();
  if (!raw) return {};

  return Object.fromEntries(
    raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && line.includes(":"))
      .map((line) => {
        const sep = line.indexOf(":");
        return [line.slice(0, sep).toLowerCase(), line.slice(sep + 1)];
      }),
  );
}

function resolveSlackId(githubUsername, usernames) {
  return usernames[githubUsername.toLowerCase()] ?? null;
}

// ─── Issue reporter mentions ──────────────────────────────────────────────

function extractClosedIssues(prBody) {
  const pattern = /(?:closes?|fixes?|resolves?)\s+#(\d+)/gi;
  return [...(prBody ?? "").matchAll(pattern)].map((m) => parseInt(m[1]));
}

function extractRequestedBy(body) {
  const pattern = /(?:requested|reported)\s+by\s+@(\w[\w-]*)/gi;
  return [...(body ?? "").matchAll(pattern)].map((m) => m[1]);
}

async function collectMentions(pr, usernames) {
  const issueNumbers = extractClosedIssues(pr.prBody);
  const slackIds = new Set();

  for (const num of issueNumbers) {
    try {
      const issue = await githubFetch(
        `/repos/${owner}/${repo}/issues/${num}`,
      );
      const authorId = resolveSlackId(issue.user.login, usernames);
      if (authorId) slackIds.add(authorId);

      for (const username of extractRequestedBy(issue.body)) {
        const id = resolveSlackId(username, usernames);
        if (id) slackIds.add(id);
      }
    } catch (err) {
      console.warn(`Could not fetch issue #${num}:`, err.message);
    }
  }

  return [...slackIds];
}

// ─── Git diff per PR ──────────────────────────────────────────────────────

const DIFF_IGNORE = [
  /\.lock$/,
  /dist\//,
  /\.min\.(js|css)$/,
  /CHANGELOG/,
  /\.snap$/,
];

async function fetchFilteredDiff(prNumber) {
  const files = await githubFetch(
    `/repos/${owner}/${repo}/pulls/${prNumber}/files`,
  );

  return files
    .filter((f) => !DIFF_IGNORE.some((pattern) => pattern.test(f.filename)))
    .map((f) => ({
      filename: f.filename,
      patch: (f.patch ?? "").slice(0, 800),
    }))
    .filter((f) => f.patch);
}

// ─── Collect PRs ──────────────────────────────────────────────────────────

async function collectPRs(usernames) {
  let previousTag;
  try {
    previousTag = execSync("git describe --tags --abbrev=0 HEAD^")
      .toString()
      .trim();
  } catch {
    console.log("No previous tag found — this appears to be the first release.");
    return [];
  }

  console.log(`Comparing ${previousTag}...${currentTag}`);

  const comparison = await githubFetch(
    `/repos/${owner}/${repo}/compare/${previousTag}...${currentTag}`,
  );

  const prDetails = await Promise.all(
    comparison.commits.map(async (commit) => {
      const prs = await githubFetch(
        `/repos/${owner}/${repo}/commits/${commit.sha}/pulls`,
      );

      if (!prs.length) return null;
      const pr = prs[0];

      const hasMappings = Object.keys(usernames).length > 0;
      const [diff, mentions] = await Promise.all([
        fetchFilteredDiff(pr.number),
        hasMappings
          ? collectMentions({ prBody: pr.body, prNumber: pr.number }, usernames)
          : [],
      ]);

      return {
        commitMessage: commit.commit.message.split("\n")[0],
        diff,
        mentions,
        prBody: (pr.body ?? "").slice(0, 1000),
        prLabels: pr.labels.map((label) => label.name),
        prNumber: pr.number,
        prTitle: pr.title,
      };
    }),
  );

  return prDetails.filter(Boolean);
}

// ─── Enrich with Claude ───────────────────────────────────────────────────

async function enrichWithClaude(prs) {
  if (!prs.length) {
    console.log("No PRs found — skipping Claude enrichment.");
    return [];
  }

  console.log(`Sending ${prs.length} PR(s) to Claude for enrichment...`);

  // Strip mentions from what we send to Claude — not relevant to summaries
  const prsForClaude = prs.map(({ mentions: _mentions, ...rest }) => rest);

  const systemPrompt = readFileSync(join(__dirname, "../prompt.md"), "utf8");
  const projectDescription = process.env.PROJECT_DESCRIPTION?.trim();

  const categoryHint = projectDescription
    ? `Project context: ${projectDescription}\n\n`
      + "Set `category` to the specific component, module, endpoint, or package "
      + "a PR relates to. If it does not relate to a specific one, return `null`."
    : "Set `category` to a human-readable label derived from the conventional "
      + "commit type — e.g. \"Features\", \"Bug Fixes\", \"Performance\", "
      + "\"Refactoring\", \"Documentation\", \"Maintenance\". "
      + "Use `null` only if the type is unclear.";

  const system = `${categoryHint}\n\n${systemPrompt}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system,
      messages: [
        {
          role: "user",
          content: `Here are the PRs in this release:\n\n${JSON.stringify(prsForClaude, null, 2)}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API error: ${response.status} — ${body}`);
  }

  const data = await response.json();
  const text = data.content.find((b) => b.type === "text")?.text ?? "[]";

  try {
    const enriched = JSON.parse(text.replace(/```json|```/g, "").trim());

    // Re-attach mentions and file count from the original PR data
    return enriched.map((entry) => {
      const pr = prs.find((p) => p.prNumber === entry.prNumber);
      return {
        ...entry,
        mentions: pr?.mentions ?? [],
        filesChanged: pr?.diff?.length ?? 0,
      };
    });
  } catch {
    console.error("Failed to parse Claude response as JSON:", text);
    return [];
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function run() {
  const usernames = parseUsernameMappings();
  const prs = await collectPRs(usernames);
  console.log(`Found ${prs.length} PR(s) associated with this release.`);

  const enriched = await enrichWithClaude(prs);
  console.log("Enriched summaries:", JSON.stringify(enriched, null, 2));

  const escaped = JSON.stringify(enriched).replace(/\n/g, "%0A");
  setOutput("summaries", escaped);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
