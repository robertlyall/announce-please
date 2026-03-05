const RELEASE_TAG = process.env.RELEASE_TAG;
const RELEASE_URL = process.env.RELEASE_URL;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const PACKAGE_NAME = process.env.PACKAGE_NAME;
const REGISTRY_URL = process.env.REGISTRY_URL;
const SLACK_CHANNEL = process.env.SLACK_CHANNEL;
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;
const REPO_NAME = GITHUB_REPOSITORY?.split("/")[1] ?? PACKAGE_NAME;
const VERSION = RELEASE_TAG.replace(/^.*?(v\d)/, "$1");

// ─── Parse summaries ──────────────────────────────────────────────────────

function parseSummaries() {
  try {
    const raw = (process.env.SUMMARIES ?? "[]").replace(/%0A/g, "\n");
    return JSON.parse(raw);
  } catch {
    console.warn("Could not parse SUMMARIES — falling back to empty list.");
    return [];
  }
}

// ─── Block Kit builders ───────────────────────────────────────────────────

function divider() {
  return { type: "divider" };
}

function headerBlock() {
  return {
    type: "header",
    text: {
      type: "plain_text",
      text: `🌿 ${REPO_NAME} ${VERSION} is out`,
      emoji: true,
    },
  };
}

function introBlock() {
  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `A new version of *${PACKAGE_NAME}* has been published. Update your projects to get the latest changes, fixes, and improvements.`,
    },
  };
}

const TYPE_ORDER = [
  "breaking", "feat", "fix", "perf", "refactor", "docs", "chore",
];

const TYPE_EMOJI = {
  breaking: "⚠️",
  feat: "✨",
  fix: "🐛",
  perf: "⚡",
  refactor: "♻️",
  docs: "📚",
  chore: "🔧",
};

function sortByFilesChanged(a, b) {
  return (b.filesChanged ?? 0) - (a.filesChanged ?? 0);
}

function formatLine({ prNumber, summary, type, mentions }) {
  const prUrl = `https://github.com/${GITHUB_REPOSITORY}/pull`;
  const emoji = TYPE_EMOJI[type] ?? "";
  const cc = mentions?.length
    ? ` (cc: ${mentions.map((id) => `<@${id}>`).join(", ")})`
    : "";
  return `${emoji} ${summary} <${prUrl}/${prNumber}|#${prNumber}>${cc}`;
}

function changelogBlocks(summaries) {
  if (!summaries.length) return [];

  const categorised = summaries.filter((s) => s.category);
  const miscItems = summaries.filter((s) => !s.category);

  const blocks = [];

  // Category groups — sorted alphabetically
  const byCategory = Object.create(null);
  for (const s of categorised) {
    (byCategory[s.category] ??= []).push(s);
  }
  const sortedCategories = Object.keys(byCategory).sort((a, b) =>
    a.localeCompare(b),
  );

  for (const category of sortedCategories) {
    const items = byCategory[category].sort(sortByFilesChanged);
    const lines = items.map(formatLine);
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${category}*\n\n${lines.join("\n")}`,
      },
    });
  }

  // Miscellaneous — sorted by type order, then by files changed
  if (miscItems.length) {
    const sorted = miscItems.sort((a, b) => {
      const typeDiff =
        TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type);
      return typeDiff !== 0 ? typeDiff : sortByFilesChanged(a, b);
    });

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Miscellaneous*\n\n${sorted.map(formatLine).join("\n")}`,
      },
    });
  }

  return blocks;
}

function actionsBlock() {
  const elements = [
    {
      type: "button",
      text: { type: "plain_text", text: "📋 Full Changelog", emoji: true },
      style: "primary",
      url: RELEASE_URL,
    },
  ];

  if (REGISTRY_URL) {
    elements.push({
      type: "button",
      text: { type: "plain_text", text: "📦 Registry", emoji: true },
      url: REGISTRY_URL,
    });
  }

  return { type: "actions", elements };
}

function footerBlock() {
  if (!SLACK_CHANNEL_ID || !SLACK_CHANNEL) return null;

  return {
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Questions or issues? Drop them in <#${SLACK_CHANNEL_ID}|${SLACK_CHANNEL}>`,
      },
    ],
  };
}

// ─── Compose and post ─────────────────────────────────────────────────────

async function run() {
  const summaries = parseSummaries();

  const blocks = [
    headerBlock(),
    introBlock(),
    divider(),
    ...changelogBlocks(summaries),
    divider(),
    actionsBlock(),
    footerBlock(),
  ].filter(Boolean);

  const payload = { blocks };

  console.log("Posting to Slack:", JSON.stringify(payload, null, 2));

  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Slack webhook failed: ${res.status} — ${body}`);
  }

  console.log("Slack notification posted successfully.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
