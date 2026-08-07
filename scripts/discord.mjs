const RELEASE_TAG = process.env.RELEASE_TAG;
const RELEASE_URL = process.env.RELEASE_URL;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const PACKAGE_NAME = process.env.PACKAGE_NAME;
const REGISTRY_URL = process.env.REGISTRY_URL;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;
const REPO_NAME = GITHUB_REPOSITORY?.split("/")[1] ?? PACKAGE_NAME;
const VERSION = RELEASE_TAG.replace(/^.*?(v\d)/, "$1");

const EMBED_COLOR = 0x5865f2;

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

// ─── Embed builders ───────────────────────────────────────────────────────

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
  const cc = mentions?.discord?.length
    ? ` (cc: ${mentions.discord.map((id) => `<@${id}>`).join(", ")})`
    : "";
  return `${emoji} ${summary} [#${prNumber}](${prUrl}/${prNumber})${cc}`;
}

function changelogFields(summaries) {
  if (!summaries.length) return [];

  const categorised = summaries.filter((s) => s.category);
  const miscItems = summaries.filter((s) => !s.category);

  const fields = [];

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
    fields.push({
      name: category,
      value: items.map(formatLine).join("\n"),
    });
  }

  // Miscellaneous — sorted by type order, then by files changed
  if (miscItems.length) {
    const sorted = miscItems.sort((a, b) => {
      const typeDiff =
        TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type);
      return typeDiff !== 0 ? typeDiff : sortByFilesChanged(a, b);
    });

    fields.push({
      name: "Miscellaneous",
      value: sorted.map(formatLine).join("\n"),
    });
  }

  return fields;
}

function links() {
  const items = [`[📋 Full Changelog](${RELEASE_URL})`];
  if (REGISTRY_URL) items.push(`[📦 Registry](${REGISTRY_URL})`);
  return items.join(" • ");
}

// ─── Compose and post ─────────────────────────────────────────────────────

async function run() {
  const summaries = parseSummaries();
  const fields = changelogFields(summaries);

  if (DISCORD_CHANNEL_ID) {
    fields.push({
      name: "Questions or issues?",
      value: `Drop them in <#${DISCORD_CHANNEL_ID}>`,
    });
  }

  const embed = {
    title: `🌿 ${REPO_NAME} ${VERSION} is out`,
    description: `A new version of **${PACKAGE_NAME}** has been published. Update your projects to get the latest changes, fixes, and improvements.\n\n${links()}`,
    color: EMBED_COLOR,
    fields,
  };

  const payload = { embeds: [embed] };

  console.log("Posting to Discord:", JSON.stringify(payload, null, 2));

  const res = await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Discord webhook failed: ${res.status} — ${body}`);
  }

  console.log("Discord notification posted successfully.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
