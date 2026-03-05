import { execSync } from "child_process";
import { appendFileSync, readFileSync } from "fs";
import { createRequire } from "module";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { parse } = require(join(process.env.ACTION_PATH, "node_modules/yaml"));

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

function loadUsernames() {
  const file = join(__dirname, "../usernames.yml");
  const { usernames } = parse(readFileSync(file, "utf8"));
  // Normalise keys to lowercase for case-insensitive lookup
  return Object.fromEntries(
    Object.entries(usernames ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
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

async function collectMentions(pr, usernames) {
  const issueNumbers = extractClosedIssues(pr.prBody);
  const slackIds = new Set();

  for (const num of issueNumbers) {
    try {
      const issue = await githubFetch(`/repos/${owner}/${repo}/issues/${num}`);
      const slackId = resolveSlackId(issue.user.login, usernames);
      if (slackId) slackIds.add(slackId);
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

      const [diff, mentions] = await Promise.all([
        fetchFilteredDiff(pr.number),
        collectMentions({ prBody: pr.body, prNumber: pr.number }, usernames),
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
      system: readFileSync(join(__dirname, "../prompt.md"), "utf8"),
      messages: [
        {
          role: "user",
          content: `Here are the PRs in this release:\n\n${JSON.stringify(prsForClaude, null, 2)}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.content.find((b) => b.type === "text")?.text ?? "[]";

  try {
    const enriched = JSON.parse(text.replace(/```json|```/g, "").trim());

    // Re-attach mentions from the original PR data
    return enriched.map((entry) => ({
      ...entry,
      mentions: prs.find((p) => p.prNumber === entry.prNumber)?.mentions ?? [],
    }));
  } catch {
    console.error("Failed to parse Claude response as JSON:", text);
    return [];
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function run() {
  const usernames = loadUsernames();
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
