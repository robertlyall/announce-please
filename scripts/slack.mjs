const RELEASE_TAG = process.env.RELEASE_TAG;
const RELEASE_URL = process.env.RELEASE_URL;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const PACKAGE_NAME = process.env.PACKAGE_NAME;
const REGISTRY_URL = process.env.REGISTRY_URL;
const SLACK_CHANNEL = process.env.SLACK_CHANNEL;
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID;
const REPO_NAME = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? PACKAGE_NAME;
const VERSION = RELEASE_TAG.replace(/^.*?(v\d)/, '$1');

// ─── Parse summaries ──────────────────────────────────────────────────────

function parseSummaries() {
  try {
    const raw = (process.env.SUMMARIES ?? '[]').replace(/%0A/g, '\n');
    return JSON.parse(raw);
  } catch {
    console.warn('Could not parse SUMMARIES — falling back to empty list.');
    return [];
  }
}

// ─── Block Kit builders ───────────────────────────────────────────────────

function divider() {
  return { type: 'divider' };
}

function headerBlock() {
  return {
    type: 'header',
    text: {
      type: 'plain_text',
      text: `🌿 ${REPO_NAME} ${VERSION} is out`,
      emoji: true,
    },
  };
}

function introBlock() {
  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `A new version of *${PACKAGE_NAME}* has been published. Update your projects to get the latest components, fixes, and improvements.`,
    },
  };
}

function metaBlock() {
  return {
    type: 'section',
    fields: [
      { type: 'mrkdwn', text: `*Version*\n\`${RELEASE_TAG}\`` },
      { type: 'mrkdwn', text: `*Package*\n\`${PACKAGE_NAME}\`` },
    ],
  };
}

const TYPE_EMOJI = {
  feat: '✨',
  fix: '🐛',
  breaking: '⚠️',
  chore: '🔧',
};

function changelogBlock(summaries) {
  if (!summaries.length) return null;

  const lines = summaries.map(({ type, prNumber, summary }) => {
    const emoji = TYPE_EMOJI[type] ?? '•';
    return `${emoji} ${summary} _(#${prNumber})_`;
  });

  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*What\'s changed*\n${lines.join('\n')}`,
    },
  };
}

function mentionsBlock(summaries) {
  const withMentions = summaries.filter(s => s.mentions?.length);
  if (!withMentions.length) return null;

  const lines = withMentions.map(({ prNumber, mentions }) => {
    const tags = mentions.map(id => `<@${id}>`).join(' ');
    return `${tags} — your reported issue was resolved in #${prNumber} 🎉`;
  });

  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: lines.join('\n'),
    },
  };
}

function actionsBlock() {
  const elements = [
    {
      type: 'button',
      text: { type: 'plain_text', text: '📋 Full Changelog', emoji: true },
      style: 'primary',
      url: RELEASE_URL,
    },
  ];

  if (REGISTRY_URL) {
    elements.push({
      type: 'button',
      text: { type: 'plain_text', text: '📦 Registry', emoji: true },
      url: REGISTRY_URL,
    });
  }

  return { type: 'actions', elements };
}

function footerBlock() {
  if (!SLACK_CHANNEL_ID || !SLACK_CHANNEL) return null;

  return {
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
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
    metaBlock(),
    divider(),
    changelogBlock(summaries),
    mentionsBlock(summaries),
    divider(),
    actionsBlock(),
    footerBlock(),
  ].filter(Boolean);

  const payload = { blocks };

  console.log('Posting to Slack:', JSON.stringify(payload, null, 2));

  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Slack webhook failed: ${res.status} — ${body}`);
  }

  console.log('Slack notification posted successfully.');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
