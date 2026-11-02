import { mkdir, writeFile } from "node:fs/promises";

const USERNAME = "Jack-ki1";
const API = "https://api.github.com";
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error("GITHUB_TOKEN is required.");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function apiJson(url, options = {}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + TOKEN,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "jack-ki1-profile-metrics",
        ...(options.headers || {}),
      },
    });
    if (response.ok) return response.json();

    const body = await response.text();
    const rateLimited = response.status === 429 ||
      (response.status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after")));
    const retryable = rateLimited || [500, 502, 503, 504].includes(response.status);
    const error = new Error("GitHub API " + response.status + ": " + body.slice(0, 400));
    if (!retryable || attempt === 4) throw error;

    const retryAfter = Number(response.headers.get("retry-after") || 0);
    const reset = Number(response.headers.get("x-ratelimit-reset") || 0);
    const resetDelay = reset > 0 ? Math.max(0, reset * 1000 - Date.now()) : 0;
    const delay = Math.min(60_000, Math.max(retryAfter * 1000, resetDelay, 1000 * (2 ** attempt)));
    console.warn("GitHub API throttled; retrying in " + Math.ceil(delay / 1000) + " seconds.");
    await sleep(delay);
  }
  throw new Error("GitHub API request exhausted retries.");
}

async function listRepos() {
  const all = [];
  for (let page = 1; page <= 20; page += 1) {
    const current = await apiJson(API + "/users/" + USERNAME + "/repos?type=owner&per_page=100&page=" + page);
    all.push(...current);
    if (current.length < 100) return all;
  }
  throw new Error("Repository pagination exceeded 2,000 entries.");
}

async function mapLimit(items, limit, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await mapper(items[index]);
    }
  }));
  return output;
}

async function getPublicCalendar() {
  const to = new Date();
  to.setUTCHours(23, 59, 59, 0);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 364);
  from.setUTCHours(0, 0, 0, 0);

  const query =
    "query ProfileContributions($login: String!, $from: DateTime!, $to: DateTime!) {" +
    " user(login: $login) {" +
    " contributionsCollection(from: $from, to: $to, includePrivateContributions: false) {" +
    " contributionCalendar { totalContributions weeks { contributionDays { date contributionCount weekday } } }" +
    " } } }";

  const result = await apiJson(API + "/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { login: USERNAME, from: from.toISOString(), to: to.toISOString() } }),
  });
  if (result.errors?.length) throw new Error("GitHub GraphQL: " + result.errors.map((e) => e.message).join("; "));
  const calendar = result.data?.user?.contributionsCollection?.contributionCalendar;
  if (!calendar?.weeks?.length) throw new Error("GitHub returned no public contribution calendar.");
  return calendar;
}

const esc = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
const fmt = (value) => new Intl.NumberFormat("en-US").format(value || 0);
const background = '<defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#081629"/><stop offset="1" stop-color="#151B38"/></linearGradient></defs><rect width="1500" height="100%" rx="22" fill="url(#bg)"/>';

function statsSvg(data) {
  const cards = [
    ["PUBLIC REPOSITORIES", fmt(data.repos), "Owned by @" + USERNAME, "#22D3EE"],
    ["STARS EARNED", fmt(data.stars), "On original public repositories", "#A78BFA"],
    ["FOLLOWERS", fmt(data.followers), "People following the work", "#34D399"],
    ["PUBLIC CONTRIBUTIONS", fmt(data.contributions), "Last 365 days · public activity", "#FBBF24"],
  ];
  const markup = cards.map((item, i) => {
    const x = 42 + i * 365;
    return '<rect x="' + x + '" y="82" width="340" height="132" rx="18" fill="#101F38" stroke="' + item[3] + '" stroke-opacity=".65"/>' +
      '<rect x="' + x + '" y="82" width="5" height="132" rx="2" fill="' + item[3] + '"/>' +
      '<text x="' + (x + 22) + '" y="116" fill="#A5B4CF" font-family="Arial,sans-serif" font-size="13" font-weight="700" letter-spacing="1.3">' + item[0] + '</text>' +
      '<text x="' + (x + 22) + '" y="169" fill="#F8FAFC" font-family="Arial,sans-serif" font-size="39" font-weight="800">' + item[1] + '</text>' +
      '<text x="' + (x + 22) + '" y="194" fill="#94A3B8" font-family="Arial,sans-serif" font-size="12">' + esc(item[2]) + '</text>';
  }).join("");
  return '<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="250" viewBox="0 0 1500 250" role="img" aria-labelledby="title desc">' +
    '<title id="title">Jackson Kimotho GitHub statistics</title><desc id="desc">Public repository count, stars, followers and public contributions in the last 365 days.</desc>' +
    '<defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#081629"/><stop offset="1" stop-color="#151B38"/></linearGradient></defs><rect width="1500" height="250" rx="22" fill="url(#bg)"/>' +
    '<text x="42" y="42" fill="#F8FAFC" font-family="Arial,sans-serif" font-size="21" font-weight="700">GitHub at a glance</text>' +
    '<text x="1458" y="42" text-anchor="end" fill="#94A3B8" font-family="Arial,sans-serif" font-size="12">PUBLIC DATA · UPDATED ' + data.updated + '</text>' + markup + '</svg>';
}

const LANG_COLORS = {
  Python:"#3572A5", TypeScript:"#3178C6", JavaScript:"#F1E05A", "Jupyter Notebook":"#DA5B0B",
  HTML:"#E34C26", CSS:"#563D7C", Java:"#B07219", C:"#555555", "C++":"#F34B7D", Go:"#00ADD8",
  Rust:"#DEA584", Shell:"#89E051", Dockerfile:"#384D54", PHP:"#4F5D95", Ruby:"#701516",
  Kotlin:"#A97BFF", Swift:"#F05138", Dart:"#00B4AB", Vue:"#41B883", SCSS:"#C6538C",
};
const FALLBACK = ["#22D3EE","#A78BFA","#34D399","#FBBF24","#60A5FA","#F472B6","#2DD4BF","#FB923C"];

function languagesSvg(allLanguages, updated) {
  const all = Object.entries(allLanguages).sort((a,b) => b[1] - a[1]);
  const top = all.slice(0, 8);
  const totalBytes = all.reduce((sum, item) => sum + item[1], 0);
  if (!top.length || totalBytes <= 0) throw new Error("No public language byte counts were returned.");
  const rows = top.map(([name, bytes], i) => {
    const share = bytes / totalBytes * 100;
    const y = 112 + i * 31;
    const color = LANG_COLORS[name] || FALLBACK[i % FALLBACK.length];
    return '<text x="55" y="' + (y + 14) + '" fill="#E2E8F0" font-family="Arial,sans-serif" font-size="15">' + esc(name) + '</text>' +
      '<rect x="260" y="' + y + '" width="840" height="17" rx="8" fill="#1E293B"/>' +
      '<rect x="260" y="' + y + '" width="' + Math.max(3, share / 100 * 840).toFixed(2) + '" height="17" rx="8" fill="' + color + '"/>' +
      '<text x="1130" y="' + (y + 14) + '" fill="#CBD5E1" font-family="Arial,sans-serif" font-size="14" text-anchor="end">' + share.toFixed(1) + '%</text>';
  }).join("");
  return '<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="390" viewBox="0 0 1500 390" role="img" aria-labelledby="title desc">' +
    '<title id="title">Programming language distribution</title><desc id="desc">Top languages by byte count across non-fork, non-archived public repositories; percentages use the complete language total.</desc>' +
    '<defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#081629"/><stop offset="1" stop-color="#151B38"/></linearGradient></defs><rect width="1500" height="390" rx="22" fill="url(#bg)"/>' +
    '<text x="55" y="48" fill="#F8FAFC" font-family="Arial,sans-serif" font-size="22" font-weight="700">Language mix</text>' +
    '<text x="55" y="74" fill="#94A3B8" font-family="Arial,sans-serif" font-size="13">Top languages by GitHub byte counts · original public repositories only</text>' +
    '<text x="1445" y="48" text-anchor="end" fill="#94A3B8" font-family="Arial,sans-serif" font-size="12">UPDATED ' + updated + '</text>' + rows + '</svg>';
}

function activitySvg(calendar, updated) {
  const weeks = calendar.weeks;
  const days = weeks.flatMap((week) => week.contributionDays);
  if (!days.length) throw new Error("Contribution calendar is empty.");
  const peak = days.reduce((best, day) => day.contributionCount > best.contributionCount ? day : best, days[0]);
  const colors = ["#17243A","#164E63","#0E7490","#0891B2","#67E8F9"];
  const cell = 15, gap = 5, x0 = 64, y0 = 105;
  const monthLabels = [];
  let previousMonth = -1;

  const cells = weeks.map((week, weekIndex) => {
    const firstDate = new Date(week.contributionDays[0].date + "T00:00:00Z");
    const month = firstDate.getUTCMonth();
    if (month !== previousMonth && (weekIndex === 0 || firstDate.getUTCDate() <= 7)) {
      monthLabels.push('<text x="' + (x0 + weekIndex * (cell + gap)) + '" y="88" fill="#94A3B8" font-family="Arial,sans-serif" font-size="12">' +
        firstDate.toLocaleString("en-US", { month:"short", timeZone:"UTC" }) + '</text>');
      previousMonth = month;
    }
    return week.contributionDays.map((day) => {
      const level = day.contributionCount === 0 ? 0 : day.contributionCount <= 2 ? 1 : day.contributionCount <= 5 ? 2 : day.contributionCount <= 9 ? 3 : 4;
      const weekday = ((Number.isInteger(day.weekday) ? day.weekday : new Date(day.date + "T00:00:00Z").getUTCDay()) + 6) % 7;
      const x = x0 + weekIndex * (cell + gap), y = y0 + weekday * (cell + gap);
      return '<rect x="' + x + '" y="' + y + '" width="' + cell + '" height="' + cell + '" rx="3" fill="' + colors[level] + '">' +
        '<title>' + esc(day.date) + ': ' + day.contributionCount + ' public contributions</title></rect>';
    }).join("");
  }).join("");

  const summaryX = 1190;
  const legend = colors.map((color, i) => '<rect x="' + (summaryX + 105 + i * 22) + '" y="246" width="14" height="14" rx="3" fill="' + color + '"/>').join("");
  return '<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="285" viewBox="0 0 1500 285" role="img" aria-labelledby="title desc">' +
    '<title id="title">Public GitHub contribution activity over the last 365 days</title><desc id="desc">Daily contribution heatmap from GitHub public contribution calendar data.</desc>' +
    '<defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#081629"/><stop offset="1" stop-color="#151B38"/></linearGradient></defs><rect width="1500" height="285" rx="22" fill="url(#bg)"/>' +
    '<text x="55" y="45" fill="#F8FAFC" font-family="Arial,sans-serif" font-size="22" font-weight="700">Public contribution activity</text>' +
    '<text x="55" y="68" fill="#94A3B8" font-family="Arial,sans-serif" font-size="13">Daily activity · trailing 365 days · public contributions only</text>' +
    '<text x="45" y="117" fill="#94A3B8" font-family="Arial,sans-serif" font-size="11">Mon</text><text x="45" y="157" fill="#94A3B8" font-family="Arial,sans-serif" font-size="11">Wed</text><text x="45" y="197" fill="#94A3B8" font-family="Arial,sans-serif" font-size="11">Fri</text>' +
    monthLabels.join("") + cells +
    '<path d="M1160 88V232" stroke="#334155"/>' +
    '<text x="' + summaryX + '" y="118" fill="#94A3B8" font-family="Arial,sans-serif" font-size="12" font-weight="700">PUBLIC CONTRIBUTIONS</text>' +
    '<text x="' + summaryX + '" y="158" fill="#F8FAFC" font-family="Arial,sans-serif" font-size="34" font-weight="800">' + fmt(calendar.totalContributions) + '</text>' +
    '<text x="' + summaryX + '" y="181" fill="#94A3B8" font-family="Arial,sans-serif" font-size="12">in the last 365 days</text>' +
    '<text x="' + summaryX + '" y="211" fill="#CBD5E1" font-family="Arial,sans-serif" font-size="12">Most active day: ' + esc(peak.date) + '</text>' +
    legend + '<text x="' + (summaryX + 105) + '" y="272" fill="#94A3B8" font-family="Arial,sans-serif" font-size="11">Less</text>' +
    '<text x="' + (summaryX + 226) + '" y="272" fill="#94A3B8" font-family="Arial,sans-serif" font-size="11">More</text>' +
    '<text x="1440" y="267" text-anchor="end" fill="#64748B" font-family="Arial,sans-serif" font-size="10">Updated ' + updated + '</text></svg>';
}

const [profile, repos, calendar] = await Promise.all([
  apiJson(API + "/users/" + USERNAME),
  listRepos(),
  getPublicCalendar(),
]);
const originals = repos.filter((repo) => !repo.fork && !repo.archived);
const languageMaps = await mapLimit(originals, 6, (repo) => apiJson(API + "/repos/" + repo.full_name + "/languages"));
const totals = {};
for (const map of languageMaps) {
  for (const [language, bytes] of Object.entries(map)) totals[language] = (totals[language] || 0) + bytes;
}
const stars = originals.reduce((sum, repo) => sum + (repo.stargazers_count || 0), 0);
const updated = new Date().toISOString().slice(0, 10);
await mkdir("assets", { recursive: true });
await Promise.all([
  writeFile("assets/github-stats.svg", statsSvg({ repos:profile.public_repos, stars, followers:profile.followers, contributions:calendar.totalContributions, updated }), "utf8"),
  writeFile("assets/github-languages.svg", languagesSvg(totals, updated), "utf8"),
  writeFile("assets/github-activity.svg", activitySvg(calendar, updated), "utf8"),
]);
console.log("Profile metrics refreshed on " + updated);
console.log("Public repositories: " + profile.public_repos);
console.log("Stars on original public repositories: " + stars);
console.log("Followers: " + profile.followers);
console.log("Public contributions (365 days): " + calendar.totalContributions);
console.log("Languages: " + Object.keys(totals).length + " across " + originals.length + " original public repositories");
