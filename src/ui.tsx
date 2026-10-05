import { Hono, type Context } from "hono";
import type { Child } from "hono/jsx";
import { login, logout, requireLogin } from "./auth.ts";
import {
	ITEM_ORDER,
	ITEM_SELECT,
	all,
	first,
	marks,
	now,
	run,
	sha256,
	type CommentRow,
	type ItemRow,
} from "./db.ts";
import { LATEST_VERSION, MADE_BY, TOPICS, helpIndex, helpTopic } from "./help.ts";
import { DEFAULT_STALE_MINUTES, GROUPS, groupOf, isStale, needsOwner, renderMarkdown } from "./lib.ts";

type Project = { id: number; slug: string; name: string; work_stale_hours: number };
type KeyRow = {
	id: number;
	agent: string;
	key_prefix: string;
	created_at: string;
	last_used_at: string | null;
	revoked_at: string | null;
	projects: string | null;
};
type AgentRow = {
	project_id: number;
	id: number;
	agent: string;
	last_used_at: string | null;
	status: string | null;
	stale_after_minutes: number | null;
};
type SummaryRow = { project_id: number; agent: string; headline: string; fields: string; updated_at: string };
type HistoryRow = { item_id: number; type: string; title: string; body: string; changed_at: string };
type Option = { id: string; label: string; description: string; recommended: boolean };

const LABELS: Record<string, string> = {
	upcoming: "Upcoming",
	working_on: "Working on",
	waiting: "Waiting",
	done: "Done",
	decision: "Decision",
	blocker: "Blocker",
	question: "Question",
	note: "Note",
};

const CSS = `
:root { color-scheme: light dark; --bg:#f6f6f4; --card:#fff; --text:#1c1c1a; --muted:#6b6b66; --line:#deded8; --accent:#2a5bd7; --warn:#b9770e; --bad:#c0392b; --good:#2e8b57; }
@media (prefers-color-scheme: dark) { :root { --bg:#161615; --card:#1f1f1d; --text:#e8e8e3; --muted:#9a9a93; --line:#33332f; --accent:#7ea2ff; --warn:#e0a84a; --bad:#ff7b6b; --good:#5fc48d; } }
* { box-sizing: border-box; }
body { margin:0; font:15px/1.5 system-ui,sans-serif; background:var(--bg); color:var(--text); }
a { color:var(--accent); text-decoration:none; } a:hover { text-decoration:underline; }
header { display:flex; gap:20px; align-items:center; padding:12px 24px; border-bottom:1px solid var(--line); background:var(--card); }
header strong { margin-right:auto; }
header form { margin:0; }
main { max-width:1100px; margin:0 auto; padding:24px; }
button.live { position:fixed; right:20px; bottom:20px; z-index:10; box-shadow:0 2px 10px rgba(0,0,0,.25); }
h1 { font-size:22px; margin:0 0 16px; } h2 { font-size:16px; margin:0 0 8px; }
h2.group { margin:28px 0 10px; padding-bottom:4px; border-bottom:1px solid var(--line); }
h3 { font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin:14px 0 4px; }
h4 { font-size:15px; margin:10px 0 4px; }
.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:16px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:16px; margin-bottom:12px; }
.grid .card { margin:0; }
.card.needs { border-left:4px solid var(--warn); } .card.needs.silenced { border-left-color:var(--line); }
.muted { color:var(--muted); font-size:13px; }
ul.plain { list-style:none; margin:0; padding:0; } ul.plain li { padding:2px 0; }
.badge { display:inline-block; font-size:12px; padding:1px 8px; border-radius:10px; border:1px solid var(--line); margin-right:6px; white-space:nowrap; }
.badge.blocker,.badge.bad { border-color:var(--bad); color:var(--bad); } .badge.question,.badge.warn { border-color:var(--warn); color:var(--warn); }
.badge.done,.badge.good { border-color:var(--good); color:var(--good); } .badge.working_on { border-color:var(--accent); color:var(--accent); }
pre { white-space:pre-wrap; word-break:break-word; font:inherit; margin:8px 0 0; }
pre.code { font:13px/1.5 ui-monospace,monospace; overflow-x:auto; white-space:pre; background:var(--bg); padding:8px; border-radius:6px; }
.md { margin-top:8px; overflow-wrap:anywhere; } .md p { margin:6px 0; } .md ul,.md ol { margin:6px 0; padding-left:22px; }
.archived { opacity:.6; }
.comment { border-left:3px solid var(--line); padding:4px 10px; margin-top:8px; }
.comment.user { border-color:var(--accent); }
.row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.actions { margin-top:10px; gap:14px; }
.filters { margin-bottom:16px; } .filters a { margin-right:12px; white-space:nowrap; } .filters a.on { font-weight:600; color:var(--text); }
input,textarea,select,button { font:inherit; padding:6px 10px; border:1px solid var(--line); border-radius:6px; background:var(--card); color:var(--text); }
input[type=checkbox] { padding:0; }
textarea { width:100%; min-height:60px; } button { cursor:pointer; } button.link { border:0; background:none; color:var(--accent); padding:0; }
button.chosen { border-color:var(--good); color:var(--good); font-weight:600; }
a.button { display:inline-block; padding:3px 10px; border:1px solid var(--line); border-radius:6px; margin:8px 6px 0 0; font-size:13px; }
form.inline { display:inline; margin:0; } form.stack { margin-top:8px; display:grid; gap:6px; }
.ask { margin-top:10px; padding:10px; border:1px dashed var(--line); border-radius:6px; }
table { width:100%; border-collapse:collapse; } th,td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); }
table.facts { width:auto; } table.facts td { border:0; padding:1px 16px 1px 0; }
.notice { border-color:var(--accent); } code { font:13px ui-monospace,monospace; word-break:break-all; }
.dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--good); margin-right:6px; } .dot.stale { background:var(--bad); }
`;

function ago(iso: string): string {
	const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
	if (seconds < 60) return "just now";
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
	return `${Math.floor(seconds / 86400)}d ago`;
}

// The page script keeps these ticking. `agent` is a key id: its time is
// replaced with the key's latest call whenever the script polls.
const When = ({ at, agent }: { at: string; agent?: number }) => (
	<span title={at} data-at={at} data-agent={agent}>
		{ago(at)}
	</span>
);

const Badge = ({ type }: { type: string }) => <span class={`badge ${type}`}>{LABELS[type] ?? type}</span>;

type Live = { token: string; needs: number };

// Changes whenever something an agent or the owner did would alter a page.
// Every part is one index row or a table with a row per agent, so polling it
// stays cheap. Heartbeat times are left out: they would reload on every call.
async function liveToken(): Promise<string> {
	const row = await first<Record<string, unknown>>(
		`SELECT (SELECT MAX(updated_at) FROM items) AS items,
		        (SELECT MAX(id) FROM comments) AS comments,
		        (SELECT MAX(id) FROM messages) AS messages,
		        (SELECT MAX(updated_at) FROM summaries) AS summaries,
		        (SELECT COUNT(*) || ' ' || MAX(silenced_at) FROM items WHERE silenced_at IS NOT NULL) AS silenced,
		        (SELECT group_concat(status, char(10)) FROM agent_status) AS statuses`,
	);
	return (await sha256(JSON.stringify(row))).slice(0, 16);
}

// How many items are waiting on the owner, across all projects, leaving out
// the ones they silenced. The tab title shows it and the icon's dot follows it.
async function needsCount(): Promise<number> {
	const rows = await all<ItemRow>(
		`SELECT type, archived_at, resolved_at, answer, blocked, needs_review FROM items
		 WHERE archived_at IS NULL AND silenced_at IS NULL`,
	);
	return rows.filter(needsOwner).length;
}

// Read before a page's own queries, so a change that lands in between causes
// one extra reload rather than being missed.
const liveState = async (): Promise<Live> => ({ token: await liveToken(), needs: await needsCount() });

const counted = (needs: number, title: string) => (needs ? `(${needs}) ${title}` : title);

// Polls /live and reloads when something changed. A hidden tab only updates
// its title, so items are not marked as seen while nobody is looking, and a
// page with a form in use offers the reload instead of taking it. Each poll
// also brings the "5m ago" stamps and the agents' stale markers up to date.
// Submitting a form remembers how far the page was scrolled, and the page it
// comes back to starts there instead of at the top. The icon carries a dot for
// as long as anything the owner has not silenced needs them.
const LIVE_JS = `(() => {
const here = location.pathname + location.search;
const [path, y] = JSON.parse(sessionStorage.getItem("scroll") ?? "[]");
sessionStorage.removeItem("scroll");
if (path === here) scrollTo(0, y);
document.addEventListener("submit", () => sessionStorage.setItem("scroll", JSON.stringify([here, scrollY])));
const ago = ${ago};
const tick = () => {
	for (const time of document.querySelectorAll("[data-at]")) time.textContent = ago(time.dataset.at);
	for (const line of document.querySelectorAll("[data-stale-after]")) {
		const time = line.querySelector("[data-at]");
		if (!time) continue;
		const stale = Date.now() - Date.parse(time.dataset.at) > line.dataset.staleAfter * 60000;
		const note = line.querySelector(".stale-note");
		line.querySelector(".dot").classList.toggle("stale", stale);
		if (stale && !note) time.insertAdjacentHTML("afterend", '<span class="stale-note"> · stale</span>');
		if (!stale) note?.remove();
	}
};
const script = document.currentScript, base = script.dataset.title;
let token = script.dataset.token, pending = false, note;
const icon = document.querySelector("link[rel=icon]");
const dirty = (f) => f.type === "checkbox" || f.type === "radio" ? f.checked !== f.defaultChecked
	: f.tagName === "SELECT" ? f.selectedIndex !== Math.max(0, [...f.options].findIndex((o) => o.defaultSelected))
	: f.type !== "hidden" && f.value !== f.defaultValue;
const busy = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "")
	|| [...document.querySelectorAll("input,textarea,select")].some(dirty);
const apply = () => {
	if (!pending || document.hidden) return;
	if (!busy()) return location.reload();
	if (note) return;
	note = document.createElement("button");
	note.className = "live";
	note.textContent = "New updates · reload";
	note.onclick = () => location.reload();
	document.body.append(note);
};
const poll = async () => {
	try {
		const response = await fetch("/live?t=" + token);
		if (response.ok && !response.redirected) {
			const state = await response.json();
			for (const time of document.querySelectorAll("[data-agent]")) {
				const at = state.seen[time.dataset.agent];
				if (at) time.dataset.at = time.title = at;
			}
			if (state.token !== token) {
				token = state.token;
				pending = true;
				document.title = (state.needs ? "(" + state.needs + ") " : "") + base;
				icon.href = state.needs ? "/favicon-alert.svg" : "/favicon.svg";
			}
		}
	} catch {}
	tick();
	apply();
};
setInterval(poll, 30000);
document.addEventListener("visibilitychange", () => document.hidden || poll());
})();`;

function Layout({ title, nav = true, live, children }: { title: string; nav?: boolean; live?: Live; children?: Child }) {
	const full = `${title} · Agent Dashboard`;
	return (
		<html lang="en">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>{counted(live?.needs ?? 0, full)}</title>
				<link rel="icon" type="image/svg+xml" href={live?.needs ? "/favicon-alert.svg" : "/favicon.svg"} />
				<style dangerouslySetInnerHTML={{ __html: CSS }} />
			</head>
			<body>
				{nav && (
					<header>
						<strong>Agent Dashboard</strong>
						<a href="/">Overview</a>
						<a href="/keys">Projects &amp; keys</a>
						<a href="/docs">API docs</a>
						<form method="post" action="/logout">
							<button class="link">Log out</button>
						</form>
					</header>
				)}
				<main>{children}</main>
				{live && <script data-token={live.token} data-title={full} dangerouslySetInnerHTML={{ __html: LIVE_JS }} />}
			</body>
		</html>
	);
}

// When each agent on a project was last heard from, and its status line.
function AgentLine({ agent }: { agent: AgentRow }) {
	const stale = isStale(agent.last_used_at, agent.stale_after_minutes ?? DEFAULT_STALE_MINUTES);
	return (
		<div data-stale-after={agent.stale_after_minutes ?? DEFAULT_STALE_MINUTES}>
			<span class={`dot ${stale ? "stale" : ""}`} />
			<strong>{agent.agent}</strong>{" "}
			<span class="muted">
				{agent.last_used_at ? <When at={agent.last_used_at} agent={agent.id} /> : "never seen"}
				{stale && <span class="stale-note"> · stale</span>}
				{agent.status && ` · ${agent.status}`}
			</span>
		</div>
	);
}

function Summary({ summary }: { summary: SummaryRow }) {
	const fields = Object.entries(JSON.parse(summary.fields) as Record<string, unknown>);
	return (
		<div style="margin-top:8px">
			{summary.headline && <div>{summary.headline}</div>}
			{fields.length > 0 && (
				<table class="facts">
					{fields.map(([name, value]) => (
						<tr>
							<td class="muted">{name}</td>
							<td>{String(value)}</td>
						</tr>
					))}
				</table>
			)}
			<div class="muted">
				{summary.agent} · updated <When at={summary.updated_at} />
			</div>
		</div>
	);
}

const slugify = (name: string) =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

// Send the user back to the page the form was on. The page script puts the
// scroll position back, so there is no anchor to jump to.
function back(c: Context, fallback: string) {
	const referer = c.req.header("Referer");
	const here = new URL(c.req.url);
	if (referer) {
		const url = new URL(referer);
		if (url.origin === here.origin) return c.redirect(url.pathname + url.search);
	}
	return c.redirect(fallback);
}

async function field(c: Context, name: string): Promise<string> {
	const value = (await c.req.parseBody())[name];
	return typeof value === "string" ? value.trim() : "";
}

const loadItem = (id: string) => first<ItemRow>(`${ITEM_SELECT} WHERE i.id = ?`, id);

// Tells the agent that posted the item what the owner said or did.
function notify(item: ItemRow, kind: string, body: string, data?: Record<string, unknown>) {
	return run(
		"INSERT INTO messages (project_id, key_id, item_id, kind, body, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		item.project_id,
		item.key_id,
		item.id,
		kind,
		body,
		data ? JSON.stringify(data) : null,
		now(),
	);
}

const AGENTS_SQL = `SELECT kp.project_id, k.id, k.agent, k.last_used_at, s.status, s.stale_after_minutes
	FROM key_projects kp JOIN api_keys k ON k.id = kp.key_id
	LEFT JOIN agent_status s ON s.key_id = k.id AND s.project_id = kp.project_id
	WHERE k.revoked_at IS NULL`;
const SUMMARIES_SQL = `SELECT s.project_id, k.agent, s.headline, s.fields, s.updated_at
	FROM summaries s JOIN api_keys k ON k.id = s.key_id WHERE k.revoked_at IS NULL`;

export const ui = new Hono();

// The second icon carries a red dot: pages use it while anything the owner
// has not silenced needs them.
const favicon = (dot: string) =>
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#2a5bd7"/><g fill="#fff"><circle cx="8.5" cy="10" r="2.5"/><rect x="13.5" y="8" width="12" height="4" rx="2"/><circle cx="8.5" cy="22" r="2.5"/><rect x="13.5" y="20" width="8" height="4" rx="2"/></g><path d="M5 16h22" stroke="#fff" stroke-opacity=".35" stroke-width="1.5"/>${dot}</svg>`;
const ICONS: Record<string, string> = {
	"/favicon.svg": favicon(""),
	"/favicon-alert.svg": favicon(`<circle cx="23" cy="9" r="8" fill="#ff3b30" stroke="#fff" stroke-width="2"/>`),
};

for (const [path, icon] of Object.entries(ICONS))
	ui.get(path, (c) => c.body(icon, 200, { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" }));

ui.get("/login", (c) =>
	c.html(
		<Layout title="Log in" nav={false}>
			<div class="card" style="max-width:340px;margin:80px auto">
				<h1>Agent Dashboard</h1>
				{c.req.query("failed") && <p class="muted">Wrong password.</p>}
				<form method="post" action="/login" class="stack">
					<input type="password" name="password" placeholder="Password" autofocus required />
					<button>Log in</button>
				</form>
			</div>
		</Layout>,
	),
);

ui.post("/login", async (c) =>
	(await login(c, await field(c, "password"))) ? c.redirect("/") : c.redirect("/login?failed=1"),
);

ui.use("*", requireLogin);

ui.post("/logout", (c) => {
	logout(c);
	return c.redirect("/login");
});

// What the page script polls: when each key last called, and the token. The
// count is only worked out when something changed.
ui.get("/live", async (c) => {
	const token = await liveToken();
	const keys = await all<{ id: number; last_used_at: string }>(
		"SELECT id, last_used_at FROM api_keys WHERE revoked_at IS NULL AND last_used_at IS NOT NULL",
	);
	const seen = Object.fromEntries(keys.map((key) => [key.id, key.last_used_at]));
	return c.json(token === c.req.query("t") ? { token, seen } : { token, seen, needs: await needsCount() });
});

ui.get("/", async (c) => {
	const live = await liveState();
	const projects = await all<Project>("SELECT * FROM projects ORDER BY name");
	const items = await all<ItemRow>(`${ITEM_SELECT} WHERE i.archived_at IS NULL ${ITEM_ORDER} LIMIT 1000`);
	const agents = await all<AgentRow>(`${AGENTS_SQL} ORDER BY k.agent`);
	const summaries = await all<SummaryRow>(SUMMARIES_SQL);

	const Section = ({ title, rows }: { title: string; rows: ItemRow[] }) =>
		rows.length ? (
			<>
				<h3>
					{title} ({rows.length})
				</h3>
				<ul class="plain">
					{rows.slice(0, 5).map((item) => (
						<li>
							<a href={`/p/${item.project}#item-${item.id}`}>{item.title}</a>{" "}
							<span class="muted">
								{item.agent} · <When at={item.updated_at} />
								{item.silenced_at && groupOf(item) === "needs" && " · silenced"}
							</span>
						</li>
					))}
				</ul>
			</>
		) : null;

	return c.html(
		<Layout title="Overview" live={live}>
			<h1>Overview</h1>
			{!projects.length && (
				<p>
					No projects yet. <a href="/keys">Create a project and an API key</a> to get started.
				</p>
			)}
			<div class="grid">
				{projects.map((project) => {
					const mine = items.filter((item) => item.project_id === project.id);
					const of = (group: string) => mine.filter((item) => groupOf(item) === group);
					return (
						<div class="card">
							<h2>
								<a href={`/p/${project.slug}`}>{project.name}</a>
							</h2>
							{agents
								.filter((agent) => agent.project_id === project.id)
								.map((agent) => (
									<AgentLine agent={agent} />
								))}
							{summaries
								.filter((summary) => summary.project_id === project.id)
								.map((summary) => (
									<Summary summary={summary} />
								))}
							<Section title="Needs you" rows={of("needs")} />
							<Section title="Working on" rows={of("working_on")} />
							<Section title="Waiting" rows={of("waiting")} />
							<Section title="Upcoming" rows={of("upcoming")} />
							<Section title="Recent decisions" rows={of("decision").slice(0, 3)} />
							<div class="muted" style="margin-top:10px">
								{of("done").length} done · {mine.length} active items
							</div>
						</div>
					);
				})}
			</div>
		</Layout>,
	);
});

function QuestionForm({ item }: { item: ItemRow }) {
	const question = JSON.parse(item.question!) as { options: Option[]; multi: boolean; allow_other: boolean };
	const answer = item.answer ? (JSON.parse(item.answer) as { selected: string[]; text: string; answered_at: string }) : null;
	const chosen = (id: string) => answer?.selected.includes(id) ?? false;
	return (
		<form method="post" action={`/items/${item.id}/answer`} class="ask stack">
			{answer && (
				<div class="muted">
					You answered <When at={answer.answered_at} />. Choosing again changes the answer.
				</div>
			)}
			{question.options.map((option) => (
				<div class="row">
					{question.multi ? (
						<label>
							<input type="checkbox" name="selected" value={option.id} checked={chosen(option.id)} />{" "}
							<strong>{option.label}</strong>
						</label>
					) : (
						<button name="selected" value={option.id} class={chosen(option.id) ? "chosen" : ""}>
							{option.label}
						</button>
					)}
					{option.recommended && <span class="badge good">recommended</span>}
					<span class="muted">{option.description}</span>
				</div>
			))}
			{question.allow_other && <input name="text" placeholder="Other answer" value={answer?.text ?? ""} />}
			{(question.multi || question.allow_other) && (
				<div>
					<button>Send answer</button>
				</div>
			)}
		</form>
	);
}

function ItemCard(props: { item: ItemRow; comments: CommentRow[]; history: HistoryRow[]; staleHours: number }) {
	const { item, comments, history } = props;
	const post = (action: string, label: string) => (
		<form method="post" action={`/items/${item.id}/${action}`} class="inline">
			<button class="link">{label}</button>
		</form>
	);
	const review = item.review ? (JSON.parse(item.review) as { verdict: string; comment: string }) : null;
	const links = JSON.parse(item.links) as { label: string; url: string }[];
	const settles = item.type === "question" || item.type === "blocker";
	const staleWork = item.type === "working_on" && isStale(item.updated_at, props.staleHours * 60);
	const needs = groupOf(item) === "needs";
	const silenced = needs && !!item.silenced_at;
	return (
		<div
			class={`card ${item.archived_at ? "archived" : ""} ${needs ? "needs" : ""} ${silenced ? "silenced" : ""}`}
			id={`item-${item.id}`}
		>
			<div class="row">
				<Badge type={item.type} />
				{item.pinned ? <span class="badge">pinned</span> : null}
				{item.blocked && <span class="badge bad">blocked</span>}
				{item.needs_review ? <span class="badge warn">needs review</span> : null}
				{item.resolved_at && <span class="badge good">resolved</span>}
				{item.answer && <span class="badge good">answered</span>}
				{staleWork && <span class="badge bad">stale</span>}
				{silenced && <span class="badge">silenced</span>}
				{item.priority !== 0 && <span class="badge">priority {item.priority}</span>}
				<strong>{item.title}</strong>
			</div>
			<div class="muted">
				{item.agent}
				{item.author && ` / ${item.author}`}
				{item.made_by && ` · decided by ${item.made_by}`} · updated <When at={item.updated_at} /> · created{" "}
				<When at={item.created_at} />
				{item.key && (
					<>
						{" "}
						· <code>{item.key}</code>
					</>
				)}
			</div>
			{item.blocked && (
				<div class="comment" style="border-color:var(--bad)">
					Blocked: {item.blocked}
				</div>
			)}
			{item.body && <div class="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.body) }} />}
			{links.map((link) => (
				<a class="button" href={link.url} rel="noopener noreferrer" target="_blank">
					{link.label}
				</a>
			))}
			{(JSON.parse(item.tags) as string[]).length > 0 && (
				<div style="margin-top:8px">
					{(JSON.parse(item.tags) as string[]).map((tag) => (
						<span class="badge">{tag}</span>
					))}
				</div>
			)}
			{item.question && <QuestionForm item={item} />}
			{item.needs_review ? (
				<form method="post" action={`/items/${item.id}/review`} class="ask stack">
					<div class="muted">Decided on your behalf. Is it fine?</div>
					<input name="comment" placeholder="Optional comment" />
					<div class="row">
						<button name="verdict" value="accepted">
							Fine
						</button>
						<button name="verdict" value="overruled">
							Overrule
						</button>
					</div>
				</form>
			) : null}
			{review && (
				<div class="comment user">
					You {review.verdict === "accepted" ? "accepted" : "overruled"} this
					{review.comment && `: ${review.comment}`}
				</div>
			)}
			{comments.map((comment) => (
				<div class={`comment ${comment.author_kind}`}>
					<div class="muted">
						{comment.author_kind === "user" ? "You" : comment.author} · <When at={comment.created_at} />
						{comment.needs_reply ? " · needs reply" : ""}
					</div>
					<div class="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(comment.body) }} />
				</div>
			))}
			<div class="row actions">
				{post(item.archived_at ? "unarchive" : "archive", item.archived_at ? "Restore" : "Archive")}
				{post("pin", item.pinned ? "Unpin" : "Pin")}
				{settles && post("resolve", item.resolved_at ? "Reopen" : "Resolve")}
				{needs && post("silence", silenced ? "Unsilence" : "Silence")}
			</div>
			<details>
				<summary class="muted">Comment</summary>
				<form method="post" action={`/items/${item.id}/comment`} class="stack">
					<textarea name="body" placeholder={`Feedback for ${item.agent}`} required />
					<div class="row">
						<button>Send</button>
						<label class="muted">
							<input type="checkbox" name="needs_reply" value="1" /> Needs a reply
						</label>
					</div>
				</form>
			</details>
			{history.length > 0 && (
				<details>
					<summary class="muted">{history.length === 1 ? "Edited once" : `Edited ${history.length} times`}</summary>
					{history.map((entry) => (
						<div class="comment">
							<div class="muted">
								Until <When at={entry.changed_at} />: {LABELS[entry.type] ?? entry.type} · {entry.title}
							</div>
							{entry.body && <pre>{entry.body}</pre>}
						</div>
					))}
				</details>
			)}
		</div>
	);
}

ui.get("/p/:slug", async (c) => {
	const project = await first<Project>("SELECT * FROM projects WHERE slug = ?", c.req.param("slug"));
	if (!project) return c.notFound();
	const live = await liveState();
	const { agent, made_by: madeBy, review, archived, stage } = c.req.query();

	const where = ["i.project_id = ?"];
	const params: unknown[] = [project.id];
	if (agent) where.push("i.agent = ?"), params.push(agent);
	if (madeBy) where.push("i.made_by = ?"), params.push(madeBy);
	if (review) where.push("i.needs_review = 1");
	where.push(archived ? "i.archived_at IS NOT NULL" : "i.archived_at IS NULL");
	const filter = where.join(" AND ");

	const matching = await all<ItemRow>(`${ITEM_SELECT} WHERE ${filter} ${ITEM_ORDER} LIMIT 500`, ...params);
	// Archived items are grouped by what they were before they were archived.
	const inGroup = (group: string) => matching.filter((item) => groupOf({ ...item, archived_at: null }) === group);
	const items = stage ? inGroup(stage) : matching;
	const comments = await all<CommentRow>(
		`SELECT c.* FROM comments c JOIN items i ON i.id = c.item_id WHERE ${filter} ORDER BY c.created_at`,
		...params,
	);
	const history = await all<HistoryRow>(
		`SELECT h.* FROM item_history h JOIN items i ON i.id = h.item_id WHERE ${filter} ORDER BY h.changed_at DESC LIMIT 1000`,
		...params,
	);
	const agents = await all<AgentRow>(`${AGENTS_SQL} AND kp.project_id = ? ORDER BY k.agent`, project.id);
	const summaries = await all<SummaryRow>(`${SUMMARIES_SQL} AND s.project_id = ?`, project.id);
	const notes = await all<{ body: string; created_at: string; agent: string | null; reads: number }>(
		`SELECT m.body, m.created_at, k.agent,
		        (SELECT COUNT(*) FROM message_acks a WHERE a.message_id = m.id) AS reads
		 FROM messages m LEFT JOIN api_keys k ON k.id = m.key_id
		 WHERE m.project_id = ? AND m.kind = 'note' ORDER BY m.created_at DESC LIMIT 5`,
		project.id,
	);
	// The owner has now had these on screen; agents see it as seen_by_owner.
	// With a stage chosen, only that stage was on screen.
	const seen = async () => {
		if (!stage) return void (await run(`UPDATE items AS i SET seen_at = ? WHERE ${filter}`, now(), ...params));
		for (let from = 0; from < items.length; from += 90) {
			const ids = items.slice(from, from + 90).map((item) => item.id);
			await run(`UPDATE items SET seen_at = ? WHERE id IN (${marks(ids)})`, now(), ...ids);
		}
	};
	if (!archived) c.executionCtx.waitUntil(seen());

	const link = (changes: Record<string, string | undefined>) => {
		const query = new URLSearchParams();
		for (const [key, value] of Object.entries({ agent, made_by: madeBy, review, archived, stage, ...changes }))
			if (value) query.set(key, value);
		const text = query.toString();
		return `/p/${project.slug}${text && `?${text}`}`;
	};
	const Filter = ({ on, to, children }: { on: boolean; to: Record<string, string | undefined>; children?: Child }) => (
		<a class={on ? "on" : ""} href={link(to)}>
			{children}
		</a>
	);
	const names = [...new Set(agents.map((row) => row.agent))];

	return c.html(
		<Layout title={project.name} live={live}>
			<h1>{project.name}</h1>
			<div class="card">
				{agents.map((row) => (
					<AgentLine agent={row} />
				))}
				{!agents.length && <span class="muted">No agent has a key for this project.</span>}
				{summaries.map((summary) => (
					<Summary summary={summary} />
				))}
			</div>

			<div class="filters">
				<Filter on={!agent} to={{ agent: undefined }}>
					All agents
				</Filter>
				{names.map((name) => (
					<Filter on={agent === name} to={{ agent: name }}>
						{name}
					</Filter>
				))}
				<span class="muted">|</span>{" "}
				<Filter on={!!review} to={{ review: review ? undefined : "1" }}>
					Needs review
				</Filter>
				<Filter on={!madeBy} to={{ made_by: undefined }}>
					Decided by anyone
				</Filter>
				{MADE_BY.map((who) => (
					<Filter on={madeBy === who} to={{ made_by: who }}>
						{who}
					</Filter>
				))}
				<span class="muted">|</span>{" "}
				<Filter on={!!archived} to={{ archived: archived ? undefined : "1" }}>
					{archived ? "Showing archived" : "Show archived"}
				</Filter>
			</div>

			<div class="filters">
				<Filter on={!stage} to={{ stage: undefined }}>
					All stages
				</Filter>
				{GROUPS.map(([group, label]) => (
					<Filter on={stage === group} to={{ stage: group }}>
						{label} ({inGroup(group).length})
					</Filter>
				))}
			</div>

			<details class="card">
				<summary>Send a note to agents</summary>
				<form method="post" action={`/p/${project.slug}/note`} class="stack">
					<textarea name="body" placeholder="Agents see this in their inbox" required />
					<div class="row">
						<select name="key">
							<option value="">Every agent on this project</option>
							{agents.map((row) => (
								<option value={row.id}>{row.agent}</option>
							))}
						</select>
						<button>Send note</button>
					</div>
				</form>
				{notes.map((note) => (
					<div class="comment user">
						<div class="muted">
							To {note.agent ?? "every agent"} · <When at={note.created_at} /> ·{" "}
							{note.reads ? `read by ${note.reads}` : "unread"}
						</div>
						<pre>{note.body}</pre>
					</div>
				))}
			</details>

			{!items.length && <p class="muted">No items match.</p>}
			{GROUPS.map(([group, label]) => {
				const rows = stage && stage !== group ? [] : inGroup(group);
				if (!rows.length) return null;
				return (
					<section id={`group-${group}`}>
						<h2 class="group row">
							{label} ({rows.length})
							{(group === "done" || group === "settled") && !archived && (
								<form method="post" action={`/p/${project.slug}/archive-${group}`} class="inline" style="margin-left:auto">
									<button class="link">Archive all {group === "done" ? "done" : "answered and resolved"}</button>
								</form>
							)}
						</h2>
						{rows.map((item) => (
							<ItemCard
								item={item}
								comments={comments.filter((comment) => comment.item_id === item.id)}
								history={history.filter((entry) => entry.item_id === item.id)}
								staleHours={project.work_stale_hours}
							/>
						))}
					</section>
				);
			})}
		</Layout>,
	);
});

ui.post("/p/:slug/note", async (c) => {
	const project = await first<Project>("SELECT * FROM projects WHERE slug = ?", c.req.param("slug"));
	if (!project) return c.notFound();
	const form = await c.req.parseBody();
	const body = typeof form.body === "string" ? form.body.trim() : "";
	const keyId = Number(form.key) || null;
	if (body)
		await run(
			"INSERT INTO messages (project_id, key_id, kind, body, created_at) VALUES (?, ?, 'note', ?, ?)",
			project.id,
			keyId,
			body,
			now(),
		);
	return back(c, `/p/${project.slug}`);
});

// Archives every active item of a project that matches `which`, telling each agent.
async function archiveAll(c: Context, which: string) {
	const at = now();
	const scope = `${which} AND archived_at IS NULL AND project_id = (SELECT id FROM projects WHERE slug = ?)`;
	await run(
		`INSERT INTO messages (project_id, key_id, item_id, kind, body, created_at)
		 SELECT project_id, key_id, id, 'archived', 'The user archived this item.', ? FROM items WHERE ${scope}`,
		at,
		c.req.param("slug"),
	);
	await run(`UPDATE items SET archived_at = ? WHERE ${scope}`, at, c.req.param("slug"));
	return back(c, `/p/${c.req.param("slug")}`);
}

ui.post("/p/:slug/archive-done", (c) => archiveAll(c, "type = 'done'"));

// The "settled" group of groupOf: questions and blockers no longer waiting on the owner.
ui.post("/p/:slug/archive-settled", (c) =>
	archiveAll(
		c,
		`type IN ('question', 'blocker') AND COALESCE(blocked, '') = '' AND needs_review = 0
		 AND (resolved_at IS NOT NULL OR COALESCE(answer, '') <> '')`,
	),
);

ui.post("/items/:id/archive", async (c) => {
	const item = await loadItem(c.req.param("id"));
	if (!item) return c.notFound();
	if (!item.archived_at) {
		await run("UPDATE items SET archived_at = ? WHERE id = ?", now(), item.id);
		await notify(item, "archived", "The user archived this item.");
	}
	return back(c, "/");
});

ui.post("/items/:id/unarchive", async (c) => {
	const item = await loadItem(c.req.param("id"));
	if (!item) return c.notFound();
	if (item.archived_at) {
		await run("UPDATE items SET archived_at = NULL WHERE id = ?", item.id);
		await notify(item, "unarchived", "The user restored this item.");
	}
	return back(c, "/");
});

ui.post("/items/:id/pin", async (c) => {
	await run("UPDATE items SET pinned = 1 - pinned WHERE id = ?", c.req.param("id"));
	return back(c, "/");
});

// Silencing is the owner's own "I will get back to this": the agent is not
// told. It ends when the owner acts on the item or the item stops needing them.
ui.post("/items/:id/silence", async (c) => {
	const item = await loadItem(c.req.param("id"));
	if (!item) return c.notFound();
	if (needsOwner(item)) await run("UPDATE items SET silenced_at = ? WHERE id = ?", item.silenced_at ? null : now(), item.id);
	return back(c, `/p/${item.project}`);
});

ui.post("/items/:id/resolve", async (c) => {
	const item = await loadItem(c.req.param("id"));
	if (!item) return c.notFound();
	const resolving = !item.resolved_at;
	await run("UPDATE items SET resolved_at = ?, silenced_at = NULL WHERE id = ?", resolving ? now() : null, item.id);
	await notify(
		item,
		resolving ? "resolved" : "reopened",
		resolving ? "The user marked this as resolved." : "The user reopened this.",
	);
	return back(c, `/p/${item.project}`);
});

ui.post("/items/:id/answer", async (c) => {
	const item = await loadItem(c.req.param("id"));
	if (!item?.question) return c.notFound();
	const question = JSON.parse(item.question) as { options: Option[]; multi: boolean; allow_other: boolean };
	const form = await c.req.parseBody({ all: true });
	let selected = question.options.map((option) => option.id).filter((id) => [form.selected ?? []].flat().includes(id));
	if (!question.multi) selected = selected.slice(0, 1);
	const text = question.allow_other && typeof form.text === "string" ? form.text.trim().slice(0, 2000) : "";
	if (selected.length || text) {
		const labels = question.options.filter((option) => selected.includes(option.id)).map((option) => option.label);
		await run(
			"UPDATE items SET answer = ?, silenced_at = NULL WHERE id = ?",
			JSON.stringify({ selected, labels, text, answered_at: now() }),
			item.id,
		);
		await notify(item, "answer", `Answer: ${[...labels, text].filter(Boolean).join("; ")}`, { selected, text });
	}
	return back(c, `/p/${item.project}`);
});

ui.post("/items/:id/review", async (c) => {
	const item = await loadItem(c.req.param("id"));
	if (!item) return c.notFound();
	const form = await c.req.parseBody();
	const verdict = form.verdict === "overruled" ? "overruled" : "accepted";
	const comment = typeof form.comment === "string" ? form.comment.trim().slice(0, 2000) : "";
	await run(
		"UPDATE items SET needs_review = 0, review = ?, silenced_at = NULL WHERE id = ?",
		JSON.stringify({ verdict, comment, at: now() }),
		item.id,
	);
	await notify(item, "review", `The user ${verdict} this decision${comment && `: ${comment}`}`, { verdict, comment });
	return back(c, `/p/${item.project}`);
});

// A comment is stored on the item's thread and delivered to the inbox of the
// agent that posted the item.
ui.post("/items/:id/comment", async (c) => {
	const item = await loadItem(c.req.param("id"));
	if (!item) return c.notFound();
	const form = await c.req.parseBody();
	const body = typeof form.body === "string" ? form.body.trim() : "";
	const needsReply = form.needs_reply === "1";
	if (body) {
		await run(
			"INSERT INTO comments (item_id, author_kind, author, body, needs_reply, created_at) VALUES (?, 'user', 'user', ?, ?, ?)",
			item.id,
			body,
			needsReply ? 1 : 0,
			now(),
		);
		await notify(item, "comment", body, { needs_reply: needsReply });
	}
	return back(c, `/p/${item.project}`);
});

async function keysPage(c: Context, created?: { agent: string; token: string }, error?: string) {
	// Only a page reached by GET can be reloaded; a form result would be resubmitted.
	const live = c.req.method === "GET" ? await liveState() : undefined;
	const projects = await all<Project>("SELECT * FROM projects ORDER BY name");
	const keys = await all<KeyRow>(
		`SELECT k.*, (SELECT GROUP_CONCAT(p.slug, ', ') FROM key_projects kp
		              JOIN projects p ON p.id = kp.project_id WHERE kp.key_id = k.id) AS projects
		 FROM api_keys k ORDER BY k.revoked_at IS NOT NULL, k.agent`,
	);
	const origin = new URL(c.req.url).origin;
	return c.html(
		<Layout title="Projects & keys" live={live}>
			<h1>Projects &amp; keys</h1>
			{error && <div class="card notice">{error}</div>}
			{created && (
				<div class="card notice">
					<h2>Key for {created.agent}</h2>
					<p>Copy it now. It is stored hashed and cannot be shown again.</p>
					<pre class="code">{created.token}</pre>
					<p class="muted">Give the agent this, for example in its CLAUDE.md or AGENTS.md:</p>
					<pre class="code">{`Report progress to the Agent Dashboard at ${origin}.
Your key is in the AGENT_DASHBOARD_KEY environment variable.
Run: curl -s ${origin}/api/help  and follow it.`}</pre>
				</div>
			)}

			<div class="card">
				<h2>Projects</h2>
				<table>
					<tr>
						<th>Project</th>
						<th>Slug</th>
						<th>Mark "working on" items stale after</th>
					</tr>
					{projects.map((project) => (
						<tr>
							<td>
								<a href={`/p/${project.slug}`}>{project.name}</a>
							</td>
							<td class="muted">{project.slug}</td>
							<td>
								<form method="post" action={`/projects/${project.id}/settings`} class="row" style="margin:0">
									<input type="number" name="work_stale_hours" min="1" max="8760" value={project.work_stale_hours} style="width:90px" />
									<span class="muted">hours without an update</span>
									<button>Save</button>
								</form>
							</td>
						</tr>
					))}
				</table>
				<form method="post" action="/projects" class="row" style="margin-top:8px">
					<input name="name" placeholder="New project name" required />
					<button>Add project</button>
				</form>
			</div>

			<div class="card">
				<h2>API keys</h2>
				<table>
					<tr>
						<th>Agent</th>
						<th>Key</th>
						<th>Projects</th>
						<th>Last seen</th>
						<th />
					</tr>
					{keys.map((key) => (
						<tr class={key.revoked_at ? "archived" : ""}>
							<td>{key.agent}</td>
							<td>
								<code>{key.key_prefix}…</code>
							</td>
							<td>{key.projects}</td>
							<td>{key.last_used_at ? <When at={key.last_used_at} agent={key.id} /> : "never"}</td>
							<td>
								{key.revoked_at ? (
									"revoked"
								) : (
									<div class="row">
										<form method="post" action={`/keys/${key.id}/rotate`} class="inline">
											<button class="link">Rotate</button>
										</form>
										<form method="post" action={`/keys/${key.id}/revoke`} class="inline">
											<button class="link">Revoke</button>
										</form>
									</div>
								)}
							</td>
						</tr>
					))}
				</table>
				<p class="muted">
					Rotate replaces the secret and keeps the agent's items and inbox. The old secret stops working at once.
				</p>
				<form method="post" action="/keys" class="stack">
					<input name="agent" placeholder="Agent name, e.g. backend-agent" required />
					<div class="row">
						{projects.map((project) => (
							<label>
								<input type="checkbox" name="projects" value={project.id} /> {project.name}
							</label>
						))}
					</div>
					<div>
						<button disabled={!projects.length}>Create key</button>
					</div>
				</form>
			</div>
		</Layout>,
	);
}

ui.get("/keys", (c) => keysPage(c));

ui.post("/projects", async (c) => {
	const name = await field(c, "name");
	const slug = slugify(name);
	if (!slug) return keysPage(c, undefined, "Project name needs at least one letter or number.");
	if (await first("SELECT 1 FROM projects WHERE slug = ?", slug))
		return keysPage(c, undefined, `A project with the slug "${slug}" already exists.`);
	await run("INSERT INTO projects (slug, name, created_at) VALUES (?, ?, ?)", slug, name, now());
	return c.redirect("/keys");
});

ui.post("/projects/:id/settings", async (c) => {
	const hours = Number(await field(c, "work_stale_hours"));
	if (Number.isInteger(hours) && hours >= 1 && hours <= 8760)
		await run("UPDATE projects SET work_stale_hours = ? WHERE id = ?", hours, c.req.param("id"));
	return c.redirect("/keys");
});

async function newToken() {
	const bytes = crypto.getRandomValues(new Uint8Array(24));
	const token = `adk_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
	return { token, hash: await sha256(token), prefix: token.slice(0, 10) };
}

ui.post("/keys", async (c) => {
	const form = await c.req.parseBody({ all: true });
	const agent = typeof form.agent === "string" ? form.agent.trim() : "";
	const projectIds = [form.projects ?? []].flat().map(Number).filter(Number.isInteger);
	if (!agent || !projectIds.length)
		return keysPage(c, undefined, "A key needs an agent name and at least one project.");

	const { token, hash, prefix } = await newToken();
	// A new agent reads the current help, so it has nothing to catch up on.
	const key = await first<{ id: number }>(
		"INSERT INTO api_keys (agent, key_hash, key_prefix, created_at, seen_version) VALUES (?, ?, ?, ?, ?) RETURNING id",
		agent,
		hash,
		prefix,
		now(),
		LATEST_VERSION,
	);
	for (const projectId of projectIds)
		await run("INSERT INTO key_projects (key_id, project_id) VALUES (?, ?)", key!.id, projectId);
	return keysPage(c, { agent, token });
});

ui.post("/keys/:id/rotate", async (c) => {
	const key = await first<{ agent: string }>(
		"SELECT agent FROM api_keys WHERE id = ? AND revoked_at IS NULL",
		c.req.param("id"),
	);
	if (!key) return c.notFound();
	const { token, hash, prefix } = await newToken();
	await run("UPDATE api_keys SET key_hash = ?, key_prefix = ? WHERE id = ?", hash, prefix, c.req.param("id"));
	return keysPage(c, { agent: key.agent, token });
});

ui.post("/keys/:id/revoke", async (c) => {
	await run("UPDATE api_keys SET revoked_at = ? WHERE id = ?", now(), c.req.param("id"));
	return c.redirect("/keys");
});

ui.get("/docs", async (c) => {
	const live = await liveState();
	const origin = new URL(c.req.url).origin;
	return c.html(
		<Layout title="API docs" live={live}>
			<h1>API docs</h1>
			<p class="muted">
				This is what agents read at <a href="/api/help">/api/help</a>.
			</p>
			<div class="card">
				<pre class="code">{helpIndex(origin)}</pre>
			</div>
			{Object.keys(TOPICS).map((name) => (
				<div class="card">
					<pre class="code">{helpTopic(name, origin)}</pre>
				</div>
			))}
		</Layout>,
	);
});
