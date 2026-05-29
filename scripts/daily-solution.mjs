#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const OUTPUT_DIR = join(ROOT, "daily-dev-solutions");
const TOPICS_FILE = join(OUTPUT_DIR, "topics.json");

const args = new Set(process.argv.slice(2));
const shouldCommitToday = args.has("--commit-today") || args.has("--push-today");
const shouldPushToday = args.has("--push-today");
const requestedTopic = getArgValue("--topic");
const requestedSource = getArgValue("--source");

const fallbackTopics = [
  {
    source: "curated",
    title: "React form state resets unexpectedly after parent rerender",
    url: "https://react.dev/learn/preserving-and-resetting-state",
    tags: ["react", "state", "forms"],
  },
  {
    source: "curated",
    title: "Supabase session is null after page refresh",
    url: "https://supabase.com/docs/guides/auth/sessions",
    tags: ["supabase", "auth", "session"],
  },
  {
    source: "curated",
    title: "Flutter layout overflow on small screens",
    url: "https://docs.flutter.dev/ui/layout/constraints",
    tags: ["flutter", "layout", "responsive"],
  },
  {
    source: "curated",
    title: "Node.js fetch request times out without a clear error",
    url: "https://nodejs.org/api/globals.html#fetch",
    tags: ["node", "fetch", "timeouts"],
  },
];

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main() {
  ensureWorkspace();

  if (shouldCommitToday) {
    commitToday(shouldPushToday);
    return;
  }

  const topic = requestedTopic ? buildManualTopic(requestedTopic, requestedSource) : await pickTopic();
  const today = new Date().toISOString().slice(0, 10);
  const entryDir = join(OUTPUT_DIR, "entries", `${today}-${slugify(topic.title)}`);

  if (existsSync(join(entryDir, "README.md"))) {
    throw new Error(`Today's entry already exists: ${entryDir}`);
  }

  mkdirSync(entryDir, { recursive: true });
  writeFileSync(join(entryDir, "README.md"), renderEntryReadme(topic, today));
  writeFileSync(join(entryDir, "notes.md"), renderNotes(topic));
  writeFileSync(join(entryDir, "example.js"), renderExample(topic));
  writeFileSync(TOPICS_FILE, JSON.stringify([...loadTopicHistory(), { ...topic, createdAt: new Date().toISOString() }], null, 2));

  console.log(`Created ${entryDir}`);
  console.log("Review the files, complete the solution, then commit when ready.");
}

function ensureWorkspace() {
  mkdirSync(join(OUTPUT_DIR, "entries"), { recursive: true });
}

function commitToday(shouldPush) {
  const today = new Date().toISOString().slice(0, 10);
  const entriesDir = join(OUTPUT_DIR, "entries");
  const todayEntries = readdirSync(entriesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${today}-`))
    .filter((entry) => existsSync(join(entriesDir, entry.name, "README.md")));

  if (todayEntries.length === 0) {
    throw new Error("No completed entry found for today. Run npm run daily:solution first.");
  }

  git("add", ".");

  if (hasStagedChanges()) {
    git("commit", "-m", `Add daily solution for ${today}`);
    console.log("Committed today's daily solution entry.");
  } else {
    console.log("No new daily solution changes to commit.");
  }

  if (shouldPush) {
    pushCurrentBranch();
    console.log("Pushed today's daily solution entry.");
  }
}

async function pickTopic() {
  const candidates = [
    ...(await fetchGitHubIssues()),
    ...(await fetchStackOverflowQuestions()),
    ...fallbackTopics,
  ];
  const seen = new Set(loadTopicHistory().map((topic) => topic.url || topic.title));
  const fresh = candidates.filter((topic) => isProblemOriented(topic.title)).filter((topic) => !seen.has(topic.url || topic.title));
  const ranked = scoreCandidates(fresh.length > 0 ? fresh : candidates);
  const topWindow = ranked.slice(0, Math.min(12, ranked.length));

  return topWindow[dayOfYear(new Date()) % topWindow.length];
}

async function fetchGitHubIssues() {
  try {
    const queries = [
      'is:issue label:bug state:open comments:>2 language:TypeScript',
      'is:issue label:bug state:open comments:>2 language:JavaScript',
      'is:issue label:"good first issue" state:open comments:>2 language:JavaScript',
    ];
    const responses = await Promise.all(queries.map((query) => searchGitHubIssues(query)));

    return responses.flat().map((issue) => ({
      source: "github-issues",
      title: issue.title,
      url: issue.html_url,
      tags: ["github", "issue", ...(issue.labels ?? []).slice(0, 3).map((label) => slugify(label.name))],
    }));
  } catch {
    return [];
  }
}

async function searchGitHubIssues(query) {
  const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&sort=comments&order=desc&per_page=8`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "dailyfix-generator",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API responded with ${response.status}`);
  }

  const data = await response.json();
  return data.items ?? [];
}

async function fetchStackOverflowQuestions() {
  const tagGroups = ["javascript;reactjs", "typescript;node.js", "flutter", "supabase"];

  try {
    const responses = await Promise.all(
      tagGroups.map(async (tags) => {
        const url = `https://api.stackexchange.com/2.3/questions?order=desc&sort=activity&tagged=${encodeURIComponent(
          tags
        )}&site=stackoverflow&pagesize=6`;
        const response = await fetch(url, {
          headers: {
            "User-Agent": "dailyfix-generator",
          },
        });

        if (!response.ok) {
          throw new Error(`Stack Exchange API responded with ${response.status}`);
        }

        const data = await response.json();
        return data.items ?? [];
      })
    );

    return responses.flat().map((question) => ({
      source: "stack-overflow",
      title: decodeHtml(question.title),
      url: question.link,
      tags: ["stackoverflow", ...(question.tags ?? []).slice(0, 4).map(slugify)],
    }));
  } catch {
    return [];
  }
}

function loadTopicHistory() {
  if (!existsSync(TOPICS_FILE)) {
    return [];
  }

  try {
    return JSON.parse(readFileSync(TOPICS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function buildManualTopic(title, source) {
  return {
    source: source ? "manual-source" : "manual",
    title,
    url: source ?? "",
    tags: ["manual", ...extractTags(title)],
  };
}

function renderEntryReadme(topic, today) {
  return `# ${topic.title}

Date: ${today}
Source: ${topic.source}${topic.url ? `\nLink: ${topic.url}` : ""}
Tags: ${topic.tags.map((tag) => `\`${tag}\``).join(" ")}

## Problem

Summarize the real-world problem in your own words. Include who is affected, when it appears, and why it matters.

## Root Cause

Explain the most likely cause after reading the source material and reproducing or researching the behavior.

## Solution

Write the final fix here. Keep it practical and include the smallest working approach before mentioning alternatives.

## Minimal Example

See \`example.js\` for a small reproducible example or helper snippet.

## Verification

- [ ] Reproduced or understood the issue from the source.
- [ ] Tested the solution locally or checked it against official docs.
- [ ] Added source links in \`notes.md\`.
- [ ] Wrote the explanation in your own words.

## Takeaway

One short lesson future you can reuse.
`;
}

function renderNotes(topic) {
  return `# Research Notes

## Source

- ${topic.url || "Manual topic"}

## Useful References

- Add official docs, issue threads, examples, or changelog links here.

## Observations

- What symptoms were reported?
- What assumptions did people make?
- What actually fixed or clarified the issue?

## Draft Answer

Start with the simplest explanation, then add code or configuration details.
`;
}

function renderExample(topic) {
  return `/**
 * Minimal example for:
 * ${topic.title}
 *
 * Replace this placeholder with a working snippet after researching the issue.
 */

function explain() {
  return "Document the smallest reproducible fix here.";
}

console.log(explain());
`;
}

function getArgValue(name) {
  const prefix = `${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : "";
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

function extractTags(title) {
  return title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3)
    .slice(0, 4);
}

function isProblemOriented(title) {
  const blocked = /\b(poem|content creation|full fix|update|marketing|newsletter|show hn|launch)\b/i;
  const useful = /\b(error|bug|fail|fix|issue|problem|crash|slow|timeout|auth|session|database|api|react|typescript|javascript|node|postgres|supabase|flutter)\b/i;
  return title.length >= 18 && useful.test(title) && !blocked.test(title);
}

function scoreCandidates(candidates) {
  return [...candidates].sort((a, b) => scoreTopic(b) - scoreTopic(a));
}

function scoreTopic(topic) {
  const title = topic.title.toLowerCase();
  let score = 0;

  if (topic.source === "stack-overflow") score += 5;
  if (topic.source === "github-issues") score += 4;
  if (topic.source === "curated") score += 3;
  if (/\b(error|bug|fail|fix|issue|problem|crash|timeout)\b/.test(title)) score += 4;
  if (/\b(auth|session|api|database|react|typescript|javascript|node|postgres|supabase|flutter)\b/.test(title)) score += 2;

  return score;
}

function decodeHtml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function dayOfYear(date) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 0));
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / 86_400_000);
}

function git(...gitArgs) {
  execFileSync("git", gitArgs, {
    cwd: ROOT,
    stdio: "inherit",
  });
}

function hasStagedChanges() {
  try {
    execFileSync("git", ["diff", "--cached", "--quiet"], {
      cwd: ROOT,
      stdio: "ignore",
    });
    return false;
  } catch {
    return true;
  }
}

function pushCurrentBranch() {
  if (!hasOriginRemote()) {
    throw new Error("No git remote named origin found. Run: git remote add origin <repo-url>");
  }

  if (hasUpstreamBranch()) {
    git("push");
    return;
  }

  git("push", "-u", "origin", "HEAD");
}

function hasOriginRemote() {
  try {
    execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: ROOT,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function hasUpstreamBranch() {
  try {
    execFileSync("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], {
      cwd: ROOT,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}
