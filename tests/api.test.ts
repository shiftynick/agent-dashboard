// Integration tests. They run against a dev server (`pnpm dev`) with
// migrations applied: BASE=http://localhost:5173 ADMIN_PASSWORD=dev by default.
import assert from "node:assert/strict";
import { before, test } from "node:test";

const BASE = process.env.BASE ?? "http://localhost:5173";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "dev";
const run = Math.random().toString(36).slice(2, 8);

let cookie = "";
let project: { id: string; slug: string; name: string };

// Submits a dashboard form (or loads a page) as the logged-in owner.
async function owner(path: string, form?: Record<string, string | string[]>) {
	const body = new URLSearchParams();
	for (const [name, value] of Object.entries(form ?? {}))
		for (const entry of [value].flat()) body.append(name, entry);
	const response = await fetch(BASE + path, {
		method: form ? "POST" : "GET",
		headers: { Cookie: cookie },
		body: form ? body : undefined,
		redirect: "manual",
	});
	return { status: response.status, text: await response.text(), headers: response.headers };
}

async function makeProject(name: string) {
	await owner("/projects", { name });
	const page = await owner("/keys");
	const id = page.text.match(new RegExp(`name="projects" value="(\\d+)"[^>]*>\\s*${name}<`))?.[1];
	assert.ok(id, "project checkbox found");
	return { id: id!, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-") };
}

async function makeKey(agent: string, projectIds = [project.id]) {
	const page = await owner("/keys", { agent, projects: projectIds });
	const token = page.text.match(/adk_[0-9a-f]{48}/)?.[0];
	assert.ok(token, "key shown once");
	return client(token!);
}

function client(token: string) {
	return async (method: string, path: string, body?: unknown) => {
		const response = await fetch(`${BASE}/api${path}`, {
			method,
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		return { status: response.status, json: (await response.json()) as any };
	};
}

const page = async () => (await owner(`/p/${project.slug}`)).text;

before(async () => {
	const response = await fetch(`${BASE}/login`, {
		method: "POST",
		body: new URLSearchParams({ password: PASSWORD }),
		redirect: "manual",
	});
	cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
	assert.ok(cookie, "logged in");
	project = await makeProject(`Test ${run}`);
});

test("a client that knows only the first API still works unchanged", async () => {
	const api = await makeKey("v1-client");
	const me = await api("GET", "/me");
	assert.equal(me.json.agent, "v1-client");
	assert.deepEqual(me.json.projects, [project.slug]);

	const created = await api("POST", "/items", { type: "working_on", title: "Add login page", body: "optional markdown", tags: ["auth"] });
	assert.equal(created.status, 201);
	for (const field of ["id", "project", "agent", "type", "title", "body", "tags", "created_at", "updated_at", "archived"])
		assert.ok(field in created.json, `item has ${field}`);
	assert.equal(created.json.archived, false);

	const patched = await api("PATCH", `/items/${created.json.id}`, { type: "done" });
	assert.equal(patched.json.type, "done");

	const list = await api("GET", `/items?project=${project.slug}&type=done&mine=true&limit=50`);
	assert.deepEqual(list.json.items.map((item: any) => item.id), [created.json.id]);

	await owner(`/items/${created.json.id}/comment`, { body: "Looks good" });
	const inbox = await api("GET", "/inbox");
	assert.equal(inbox.json.messages.length, 1);
	const message = inbox.json.messages[0];
	assert.equal(message.kind, "comment");
	assert.equal(message.item_id, created.json.id);
	assert.equal(message.item_title, "Add login page");
	assert.equal(message.body, "Looks good");
	assert.equal(message.read, false);

	const reply = await api("POST", `/items/${created.json.id}/comments`, { body: "Thanks" });
	assert.equal(reply.status, 201);
	const thread = await api("GET", `/items/${created.json.id}`);
	assert.deepEqual(thread.json.comments.map((comment: any) => comment.author), ["user", "v1-client"]);

	assert.equal((await api("POST", "/inbox/ack", { ids: [message.id] })).json.acknowledged, 1);
	assert.equal((await api("GET", "/inbox")).json.messages.length, 0);
	assert.equal((await api("POST", "/inbox/ack", { all: true })).json.acknowledged, 0);

	const error = await api("POST", "/items", { type: "nope", title: "x" });
	assert.equal(error.status, 400);
	assert.match(error.json.help, /\/api\/help\/items$/);
});

test("1. the owner answers a question with options, and can change the answer", async () => {
	const api = await makeKey("asker");
	const options = [
		{ id: "a", label: "Option A", description: "first", recommended: true },
		{ id: "b", label: "Option B" },
		{ id: "c", label: "Option C" },
	];
	const question = await api("PUT", "/items/by-key/q-one", { type: "question", title: "Which one?", options, allow_other: true });
	assert.equal(question.status, 201);
	assert.equal(question.json.options.length, 3);
	const html = await page();
	assert.ok(html.includes("Option A") && html.includes("recommended"));
	assert.ok(html.indexOf(`id="item-${question.json.id}"`) < html.indexOf('id="group-working_on"') || !html.includes('id="group-working_on"'));

	await owner(`/items/${question.json.id}/answer`, { selected: "b", text: "but keep A as fallback" });
	let inbox = await api("GET", "/inbox");
	assert.equal(inbox.json.messages.length, 1);
	const answer = inbox.json.messages[0];
	assert.equal(answer.kind, "answer");
	assert.equal(answer.item_id, question.json.id);
	assert.equal(answer.item_key, "q-one");
	assert.deepEqual(answer.selected, ["b"]);
	assert.equal(answer.text, "but keep A as fallback");
	await api("POST", "/inbox/ack", { ids: [answer.id] });

	const read = await api("GET", `/items/${question.json.id}`);
	assert.deepEqual(read.json.answer.selected, ["b"]);
	assert.ok((await page()).includes('id="group-settled"'), "answered question leaves Needs you");

	await owner(`/items/${question.json.id}/answer`, { selected: "c" });
	inbox = await api("GET", "/inbox");
	assert.equal(inbox.json.messages.length, 1);
	assert.deepEqual(inbox.json.messages[0].selected, ["c"]);

	const bad = await api("POST", "/items", { type: "question", title: "x", options: [{ id: "a", label: "only one" }] });
	assert.equal(bad.status, 400);
	assert.match(bad.json.help, /help\/questions$/);
});

test("2. the agent hears about archiving, and an update does not un-archive", async () => {
	const api = await makeKey("archivee");
	const item = (await api("POST", "/items", { type: "note", title: "Old news", key: "old" })).json;
	await owner(`/items/${item.id}/archive`, {});
	const inbox = await api("GET", "/inbox");
	assert.deepEqual(inbox.json.messages.map((m: any) => [m.kind, m.item_id, m.item_key]), [["archived", item.id, "old"]]);

	const patched = await api("PATCH", `/items/${item.id}`, { body: "still here" });
	assert.equal(patched.json.archived, true);
	assert.equal((await api("PUT", "/items/by-key/old", { body: "again" })).json.archived, true);
	assert.equal((await api("GET", "/items?mine=true")).json.items.length, 0);

	assert.equal((await api("PATCH", `/items/${item.id}`, { unarchive: true })).json.archived, false);

	await owner(`/items/${item.id}/archive`, {});
	await owner(`/items/${item.id}/unarchive`, {});
	const kinds = (await api("GET", "/inbox")).json.messages.map((m: any) => m.kind);
	assert.deepEqual(kinds, ["archived", "archived", "unarchived"]);
});

test("3. upsert by a key the agent chooses", async () => {
	const one = await makeKey("upserter-1");
	const two = await makeKey("upserter-2");
	const first = await one("PUT", "/items/by-key/issue-201", { type: "working_on", title: "Fix redirect" });
	assert.equal(first.status, 201);
	const second = await one("PUT", "/items/by-key/issue-201", { type: "done", body: "merged" });
	assert.equal(second.status, 200);
	assert.equal(second.json.id, first.json.id);
	assert.equal(second.json.title, "Fix redirect");
	assert.equal(second.json.type, "done");

	const other = await two("PUT", "/items/by-key/issue-201", { type: "note", title: "Mine" });
	assert.equal(other.status, 201);
	assert.notEqual(other.json.id, first.json.id);

	assert.equal((await one("GET", "/items/by-key/issue-201")).json.id, first.json.id);
	assert.equal((await one("GET", "/items/by-key/missing")).status, 404);
	assert.equal((await one("PUT", "/items/by-key/issue-202", { body: "no type" })).status, 400);

	// POST with an existing key is a safe retry, not a duplicate.
	const retry = await one("POST", "/items", { key: "issue-201", type: "done", title: "Fix redirect" });
	assert.equal(retry.status, 200);
	assert.equal(retry.json.id, first.json.id);

	await one("PUT", "/items/by-key/note-upcoming", { type: "note", title: "Plans" });
	const prefix = await one("GET", "/items?mine=true&key_prefix=issue-");
	assert.deepEqual(prefix.json.items.map((item: any) => item.key), ["issue-201"]);
	const exact = await one("GET", "/items?key=issue-201");
	assert.equal(exact.json.items.length, 2, "both agents' items are readable in the project");

	const history = await one("GET", `/items/${first.json.id}?history=true`);
	assert.deepEqual(history.json.history.map((entry: any) => entry.type), ["working_on"]);
});

test("4. heartbeat shows the agent as alive with its status line", async () => {
	const api = await makeKey("pulse");
	assert.equal((await api("GET", "/me")).json.last_seen, null);
	const beat = await api("POST", "/heartbeat", { status: "Running the suite", stale_after_minutes: 1 });
	assert.deepEqual(beat.json.projects, [project.slug]);
	const me = await api("GET", "/me");
	assert.ok(me.json.last_seen);
	assert.deepEqual(
		me.json.heartbeats.map((h: any) => [h.project, h.status, h.stale_after_minutes]),
		[[project.slug, "Running the suite", 1]],
	);
	const line = (await page()).match(/<strong>pulse<\/strong>.*?<\/div>/s)?.[0] ?? "";
	assert.ok(line.includes("just now") && line.includes("Running the suite") && !line.includes("stale"), line);
	assert.equal((await api("POST", "/heartbeat", { stale_after_minutes: 0 })).status, 400);

	const silent = await makeKey("silent");
	void silent;
	const quiet = (await page()).match(/<strong>silent<\/strong>.*?<\/div>/s)?.[0] ?? "";
	assert.ok(quiet.includes("never seen") && quiet.includes("stale"), quiet);
});

test("5. stages are grouped in order, and resolving is separate from archiving", async () => {
	const fresh = await makeProject(`Stages ${run}`);
	const api = await makeKey("stager", [fresh.id]);
	for (const type of ["note", "done", "decision", "upcoming", "waiting", "working_on", "question", "blocker"])
		assert.equal((await api("POST", "/items", { type, title: `A ${type}`, key: type })).status, 201);
	await api("POST", "/items", { type: "working_on", title: "Stuck task", blocked: "Need the staging password", key: "stuck" });

	let html = (await owner(`/p/${fresh.slug}`)).text;
	const order = ["needs", "working_on", "waiting", "upcoming", "decision", "done", "note"].map((group) => html.indexOf(`id="group-${group}"`));
	assert.ok(order.every((index) => index > 0), "every group is shown");
	assert.deepEqual(order, [...order].sort((a, b) => a - b));
	assert.match(html, /Needs you \(3\)/);
	assert.ok(html.includes("Need the staging password"));

	const blocker = (await api("GET", "/items/by-key/blocker")).json;
	const resolved = await api("PATCH", `/items/${blocker.id}`, { resolved: true });
	assert.equal(resolved.json.resolved, true);
	assert.equal(resolved.json.archived, false);
	await api("PUT", "/items/by-key/stuck", { blocked: null });
	html = (await owner(`/p/${fresh.slug}`)).text;
	assert.match(html, /Needs you \(1\)/);
	assert.match(html, /Answered and resolved \(1\)/);

	assert.equal((await api("PUT", "/items/by-key/note", { resolved: true })).status, 400);

	const question = (await api("GET", "/items/by-key/question")).json;
	await owner(`/items/${question.id}/resolve`, {});
	const inbox = await api("GET", "/inbox");
	assert.deepEqual(inbox.json.messages.map((m: any) => [m.kind, m.item_key]), [["resolved", "question"]]);
	assert.equal((await api("GET", `/items/${question.id}`)).json.resolved, true);
});

test("6. order is pinned, then priority, then newest", async () => {
	const api = await makeKey("orderer");
	const ids: Record<number, number> = {};
	for (const priority of [2, 0, 1])
		ids[priority] = (await api("POST", "/items", { type: "question", title: `Priority ${priority}`, priority })).json.id;
	const listed = async () => (await api("GET", "/items?mine=true")).json.items.map((item: any) => item.priority);
	assert.deepEqual(await listed(), [2, 1, 0]);
	await owner(`/items/${ids[0]}/pin`, {});
	assert.deepEqual(await listed(), [0, 2, 1]);
	const html = await page();
	assert.ok(html.indexOf(`id="item-${ids[0]}"`) < html.indexOf(`id="item-${ids[2]}"`));
	assert.ok(html.includes("updated <span") && html.includes("created <span"));
	await api("PATCH", `/items/${ids[1]}`, { pinned: true });
	assert.equal((await api("GET", `/items/${ids[1]}`)).json.pinned, true);
});

test("7. a decision made on the owner's behalf can be overruled", async () => {
	const api = await makeKey("decider");
	const decision = await api("POST", "/items", { type: "decision", title: "Round prices up", made_by: "orchestrator", needs_review: true, key: "rounding" });
	assert.equal(decision.json.needs_review, true);
	assert.equal(decision.json.made_by, "orchestrator");
	assert.equal((await api("POST", "/items", { type: "decision", title: "x", made_by: "nobody" })).status, 400);

	const filtered = (await owner(`/p/${project.slug}?review=1&made_by=orchestrator`)).text;
	assert.ok(filtered.includes("Round prices up") && filtered.includes("Overrule"));
	assert.ok(!(await owner(`/p/${project.slug}?made_by=worker`)).text.includes("Round prices up"));

	await owner(`/items/${decision.json.id}/review`, { verdict: "overruled", comment: "Round to nearest" });
	const inbox = await api("GET", "/inbox");
	const review = inbox.json.messages[0];
	assert.deepEqual([review.kind, review.item_id, review.item_key, review.verdict, review.comment], ["review", decision.json.id, "rounding", "overruled", "Round to nearest"]);
	const after = (await api("GET", `/items/${decision.json.id}`)).json;
	assert.equal(after.needs_review, false);
	assert.equal(after.review.verdict, "overruled");
});

test("8. hostile item content is shown as text", async () => {
	const api = await makeKey("hostile");
	const body = '<script>alert(1)</script>\n<img src=x onerror="alert(2)">\n[click](javascript:alert(3))';
	const item = (await api("POST", "/items", { type: "note", title: "<script>alert('title')</script>", body, tags: ["<b>tag</b>"] })).json;
	await owner(`/items/${item.id}/comment`, { body });
	const html = await page();
	assert.ok(!html.includes("<script>alert"));
	assert.ok(!html.includes("<img"));
	assert.ok(!/href="javascript:/i.test(html));
	assert.ok(!html.includes("<b>tag</b>"));
	assert.ok(html.includes("&lt;script&gt;alert(1)"));

	const link = await api("POST", "/items", { type: "note", title: "x", links: [{ label: "bad", url: "javascript:alert(1)" }] });
	assert.equal(link.status, 400);
	assert.match(await (await fetch(`${BASE}/api/help/conventions`)).text(), /Never post secrets, credentials/);
});

test("8. writes are rate limited per key with a clear error", async () => {
	const api = await makeKey("flooder");
	const results = await Promise.all(Array.from({ length: 125 }, () => api("POST", "/heartbeat", {})));
	const limited = results.filter((result) => result.status === 429);
	// The window is a calendar minute, so a run that straddles one may allow more.
	assert.ok(limited.length >= 1 && limited.length <= 5, `${limited.length} limited`);
	assert.match(limited[0].json.help, /help\/limits$/);
	assert.ok(limited[0].json.retry_after > 0);
	assert.equal((await api("GET", "/me")).status, 200, "reads are not limited");
});

test("8. the owner can rotate a key; the agent keeps its items", async () => {
	const old = await makeKey("rotated");
	const item = (await old("POST", "/items", { type: "note", title: "Before rotation" })).json;
	const keys = await owner("/keys");
	const id = keys.text.match(/<td>rotated<\/td>.*?\/keys\/(\d+)\/rotate/s)?.[1];
	const rotated = await owner(`/keys/${id}/rotate`, {});
	const api = client(rotated.text.match(/adk_[0-9a-f]{48}/)![0]);
	assert.equal((await old("GET", "/me")).status, 401);
	assert.equal((await api("PATCH", `/items/${item.id}`, { body: "after" })).status, 200);
	await owner(`/keys/${id}/revoke`, {});
	assert.equal((await api("GET", "/me")).status, 401);
});

test("9. links, project summary, cheap polling and long polling", async () => {
	const api = await makeKey("extras");
	const item = (await api("POST", "/items", { type: "note", title: "With links", author: "worker-3", links: [{ label: "PR 12", url: "https://example.com/pr/12" }] })).json;
	assert.equal(item.author, "worker-3");
	let html = await page();
	assert.ok(html.includes('<a class="button" href="https://example.com/pr/12" rel="noopener noreferrer"'));
	assert.ok(html.includes("extras / worker-3"));

	const put = await api("PUT", `/projects/${project.slug}/summary`, { headline: `Headline ${run}`, fields: { spent: "$41 of $100", machine: "busy" } });
	assert.equal(put.json.headline, `Headline ${run}`);
	const merged = await api("PATCH", `/projects/${project.slug}/summary`, { fields: { spent: "$47 of $100", machine: null, checks: true } });
	assert.deepEqual(merged.json.fields, { spent: "$47 of $100", checks: true });
	assert.equal(merged.json.headline, `Headline ${run}`);
	assert.deepEqual((await api("GET", `/projects/${project.slug}/summary`)).json.fields, merged.json.fields);
	html = await page();
	assert.ok(html.includes(`Headline ${run}`) && html.includes("$47 of $100"));
	assert.ok((await owner("/")).text.includes(`Headline ${run}`));

	// seen_by_owner: the project page has been loaded since the item was posted.
	assert.equal(item.seen_by_owner, false);
	await new Promise((resolve) => setTimeout(resolve, 300));
	assert.equal((await api("GET", `/items/${item.id}`)).json.seen_by_owner, true);

	await owner(`/items/${item.id}/comment`, { body: "first", needs_reply: "1" });
	await owner(`/items/${item.id}/comment`, { body: "second" });
	const both = (await api("GET", "/inbox")).json.messages;
	assert.deepEqual(both.map((m: any) => [m.body, m.needs_reply]), [["first", true], ["second", false]]);
	const since = (await api("GET", `/inbox?since=${both[0].id}`)).json.messages;
	assert.deepEqual(since.map((m: any) => m.body), ["second"]);
	await api("POST", "/inbox/ack", { all: true });

	const started = Date.now();
	const waiting = api("GET", "/inbox?wait=20");
	setTimeout(() => owner(`/p/${project.slug}/note`, { body: "wake up", key: "" }), 1000);
	const woken = await waiting;
	assert.deepEqual(woken.json.messages.map((m: any) => [m.kind, m.body]), [["note", "wake up"]]);
	assert.ok(Date.now() - started < 8000, "long poll returns soon after the note");

	const empty = Date.now();
	await api("POST", "/inbox/ack", { all: true });
	assert.equal((await api("GET", "/inbox?wait=3")).json.messages.length, 0);
	assert.ok(Date.now() - empty >= 2500, "long poll waits when nothing arrives");
});

test("an agent that predates a release is told about it in the inbox, once", async () => {
	const api = await makeKey("veteran");
	// Make the key look like one created before the current release.
	const explorer = `${BASE}/cdn-cgi/local/explorer/api/d1/database`;
	const database = ((await (await fetch(explorer)).json()) as any).result[0].uuid;
	const set = await fetch(`${explorer}/${database}/raw`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ sql: "UPDATE api_keys SET seen_version = 1 WHERE agent = 'veteran'" }),
	});
	assert.ok(set.ok);

	// Project-wide notes from other tests also land here; look only at changes.
	const inbox = (await api("GET", "/inbox")).json.messages.filter((m: any) => m.kind === "changes");
	assert.equal(inbox.length, 1);
	assert.equal(inbox[0].version, 2);
	assert.match(inbox[0].body, /by-key/);
	assert.match(inbox[0].body, /\/api\/help\/changes/);
	await api("POST", "/inbox/ack", { all: true });
	assert.equal((await api("GET", "/inbox")).json.messages.length, 0);

	const newcomer = await makeKey("newcomer");
	assert.ok((await newcomer("GET", "/inbox?all=true")).json.messages.every((m: any) => m.kind !== "changes"));
});

test("the dashboard notices agent updates and counts what needs the owner", async () => {
	const api = await makeKey("live-agent");
	const live = async (token = "") => JSON.parse((await owner(`/live?t=${token}`)).text) as { token: string; needs?: number; seen: Record<string, string> };
	const count = (html: string) => Number(html.match(/<title>\((\d+)\) /)?.[1] ?? 0);

	const before = await live();
	assert.equal(typeof before.needs, "number");
	const same = await live(before.token);
	assert.equal(same.token, before.token);
	assert.equal(same.needs, undefined, "nothing changed, nothing counted");
	assert.equal(count(await page()), before.needs);

	await api("POST", "/items", { type: "question", title: "Ship it?" });
	const after = await live(before.token);
	assert.notEqual(after.token, before.token);
	assert.equal(after.needs, before.needs! + 1);
	const html = await page();
	assert.equal(count(html), after.needs);
	assert.match(html, /<script data-token="[0-9a-f]{16}"/);
	const icons = await Promise.all(["/favicon.svg", "/favicon-alert.svg"].map((path) => fetch(BASE + path).then((r) => r.text())));
	assert.ok(icons.every((icon) => icon.startsWith("<svg")) && icons[0] !== icons[1]);

	// The icon's dot is on while anything needs the owner, until they silence it.
	const question = (await api("GET", "/items?mine=true")).json.items.find((item: { title: string }) => item.title === "Ship it?");
	assert.match(html, /rel="icon"[^>]*href="\/favicon-alert\.svg"/);
	await owner(`/items/${question.id}/silence`, {});
	const silenced = await live(after.token);
	assert.notEqual(silenced.token, after.token, "other tabs hear about it");
	assert.equal(silenced.needs, before.needs);
	const quietPage = await page();
	assert.equal(count(quietPage), before.needs);
	assert.match(quietPage, />silenced<\/span>/);
	assert.match(quietPage, />Unsilence</);
	if (!before.needs) assert.match(quietPage, /rel="icon"[^>]*href="\/favicon\.svg"/);
	assert.equal((await api("GET", `/items/${question.id}`)).json.silenced_at, undefined, "the agent is not told");
	await owner(`/items/${question.id}/silence`, {});
	assert.equal((await live(silenced.token)).needs, after.needs, "unsilenced, it counts again");
	// Silence ends once the item stops needing the owner, so a later blocker shows.
	await owner(`/items/${question.id}/silence`, {});
	await api("PATCH", `/items/${question.id}`, { resolved: true });
	await api("PATCH", `/items/${question.id}`, { blocked: "need the prod password" });
	const blocked = await live();
	assert.equal(blocked.needs, after.needs);
	assert.doesNotMatch(await page(), />silenced<\/span>/);

	await api("POST", "/heartbeat", { status: "thinking" });
	const status = await live(blocked.token);
	assert.notEqual(status.token, blocked.token);
	await api("POST", "/heartbeat", {});
	const quiet = await live(status.token);
	assert.equal(quiet.token, status.token, "a repeated heartbeat does not reload the page");

	// Times are sent as timestamps for the page script to keep current, and the
	// agent's last call reaches the page without a reload.
	const stamp = (await page()).match(/data-at="([^"]+)" data-agent="(\d+)"/);
	assert.ok(stamp, "agent line carries its key id");
	assert.ok(Object.values(quiet.seen).every((at) => !Number.isNaN(Date.parse(at))));
	assert.ok(stamp![2] in quiet.seen);

	// The page that shows a new key once must never reload itself.
	const created = await owner("/keys", { agent: "live-other", projects: [project.id] });
	assert.match(created.text, /adk_[0-9a-f]{48}/);
	assert.doesNotMatch(created.text, /data-token=/);
	assert.doesNotMatch((await fetch(`${BASE}/login`).then((r) => r.text())), /data-token=/);
});

test("the owner can look at one stage at a time, and actions return to the same view", async () => {
	const api = await makeKey("stager");
	const working = (await api("POST", "/items", { type: "working_on", title: `Building ${run}` })).json;
	const waiting = (await api("POST", "/items", { type: "waiting", title: `Parked ${run}` })).json;
	const question = (await api("POST", "/items", { type: "question", title: `Asking ${run}` })).json;

	const view = `/p/${project.slug}?stage=waiting`;
	const html = (await owner(view)).text;
	for (const stage of ["needs", "working_on", "waiting", "upcoming", "decision", "done", "note", "settled"])
		assert.ok(html.includes(`stage=${stage}"`), `filter for ${stage}`);
	assert.ok(html.includes(`Parked ${run}`) && !html.includes(`Building ${run}`) && !html.includes(`Asking ${run}`));
	assert.ok((await owner(`/p/${project.slug}?stage=needs`)).text.includes(`Asking ${run}`));

	// Only what was on screen counts as seen.
	await new Promise((resolve) => setTimeout(resolve, 300));
	assert.equal((await api("GET", `/items/${waiting.id}`)).json.seen_by_owner, true);
	assert.equal((await api("GET", `/items/${working.id}`)).json.seen_by_owner, false);

	// An action comes back to the filtered view, with no anchor to jump to.
	const response = await fetch(`${BASE}/items/${question.id}/resolve`, {
		method: "POST",
		headers: { Cookie: cookie, Referer: BASE + view },
		redirect: "manual",
	});
	assert.equal(response.headers.get("location"), view);
	assert.ok((await owner(`/p/${project.slug}?stage=settled`)).text.includes(`Asking ${run}`));
});

test("the owner can archive everything answered and resolved at once", async () => {
	const api = await makeKey("settler");
	const make = async (body: Record<string, unknown>) => (await api("POST", "/items", body)).json.id as number;
	const resolved = await make({ type: "blocker", title: `Unblocked ${run}`, resolved: true });
	const answered = await make({ type: "question", title: `Answered ${run}`, options: [{ id: "y", label: "Yes" }, { id: "n", label: "No" }] });
	const open = await make({ type: "question", title: `Open ${run}` });
	const blocked = await make({ type: "question", title: `Stuck ${run}`, resolved: true, blocked: "waiting on access" });
	const done = await make({ type: "done", title: `Finished ${run}` });
	await owner(`/items/${answered}/answer`, { selected: "y" });
	await api("POST", "/inbox/ack", { all: true });

	assert.ok((await page()).includes(`action="/p/${project.slug}/archive-settled"`));
	assert.equal((await owner(`/p/${project.slug}/archive-settled`, {})).status, 302);
	const archived = async (id: number) => (await api("GET", `/items/${id}`)).json.archived;
	assert.deepEqual(await Promise.all([resolved, answered, open, blocked, done].map(archived)), [true, true, false, false, false]);

	const inbox = (await api("GET", "/inbox")).json.messages.filter((m: any) => m.kind === "archived");
	assert.deepEqual(inbox.map((m: any) => m.item_id).sort(), [resolved, answered].sort());
});

test("help covers every topic, endpoint and the changelog", async () => {
	const index = await (await fetch(`${BASE}/api/help`)).text();
	for (const topic of ["auth", "items", "keys", "questions", "decisions", "comments", "inbox", "heartbeat", "summary", "limits", "conventions", "changes"]) {
		assert.ok(index.includes(`/api/help/${topic}`), topic);
		assert.equal((await fetch(`${BASE}/api/help/${topic}`)).status, 200);
	}
	for (const path of ["/api/items/by-key/:key", "/api/heartbeat", "/api/projects/:slug/summary"]) assert.ok(index.includes(path));
	const changes = await (await fetch(`${BASE}/api/help/changes`)).text();
	assert.ok(changes.indexOf("Version 2") < changes.indexOf("Version 1"));
	for (const [topic, phrase] of [["inbox", "archived"], ["inbox", "wait="], ["questions", "allow_other"], ["decisions", "needs_review"], ["keys", "by-key"]])
		assert.ok((await (await fetch(`${BASE}/api/help/${topic}`)).text()).includes(phrase), `${topic}: ${phrase}`);
});
