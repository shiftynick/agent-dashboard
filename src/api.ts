import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
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
import {
	ITEM_TYPES,
	LATEST_VERSION,
	CHANGES,
	MADE_BY,
	WRITES_PER_MINUTE,
	changesText,
	helpIndex,
	helpTopic,
} from "./help.ts";

type Project = { id: number; slug: string };
type Agent = {
	keyId: number;
	name: string;
	projects: Project[];
	lastSeen: string | null;
	seenVersion: number;
};
type Vars = { Variables: { agent: Agent } };
type Ctx = Context<Vars>;
type Input = Record<string, unknown>;

const base = (c: Context) => new URL(c.req.url).origin;

// Every error names the help topic that explains the fix.
class ApiError extends Error {
	constructor(
		public status: ContentfulStatusCode,
		message: string,
		public topic = "",
		public extra: Record<string, unknown> = {},
	) {
		super(message);
	}
}

const KEY_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;
const isString = (value: unknown, max: number): value is string =>
	typeof value === "string" && value.length <= max;
const isHttpUrl = (value: unknown) => isString(value, 2000) && /^https?:\/\/\S+$/.test(value);

function itemJson(row: ItemRow) {
	const question = row.question ? JSON.parse(row.question) : null;
	return {
		id: row.id,
		key: row.key,
		project: row.project,
		agent: row.agent,
		author: row.author,
		type: row.type,
		title: row.title,
		body: row.body,
		tags: JSON.parse(row.tags) as string[],
		links: JSON.parse(row.links),
		priority: row.priority,
		pinned: !!row.pinned,
		blocked: row.blocked,
		resolved: row.resolved_at !== null,
		resolved_at: row.resolved_at,
		made_by: row.made_by,
		needs_review: !!row.needs_review,
		review: row.review ? JSON.parse(row.review) : null,
		options: question?.options ?? null,
		multi: question?.multi ?? false,
		allow_other: question?.allow_other ?? false,
		answer: row.answer ? JSON.parse(row.answer) : null,
		created_at: row.created_at,
		updated_at: row.updated_at,
		archived: row.archived_at !== null,
		seen_by_owner: row.seen_at !== null && row.seen_at >= row.updated_at,
	};
}

function parseOptions(input: Input, existing: ItemRow | null) {
	const previous = existing?.question ? JSON.parse(existing.question) : {};
	const options = input.options ?? previous.options;
	const invalid = new ApiError(
		400,
		"options must be 2 to 10 of {id, label, description?, recommended?} with unique ids",
		"questions",
	);
	if (!Array.isArray(options) || options.length < 2 || options.length > 10) throw invalid;
	const clean = options.map((option) => {
		if (!option || !isString(option.id, 50) || !option.id || !isString(option.label, 200) || !option.label)
			throw invalid;
		if (option.description !== undefined && !isString(option.description, 500)) throw invalid;
		return {
			id: option.id,
			label: option.label,
			description: option.description ?? "",
			recommended: option.recommended === true,
		};
	});
	if (new Set(clean.map((option) => option.id)).size !== clean.length) throw invalid;
	for (const flag of ["multi", "allow_other"])
		if (input[flag] !== undefined && typeof input[flag] !== "boolean")
			throw new ApiError(400, `${flag} must be true or false`, "questions");
	return JSON.stringify({
		options: clean,
		multi: input.multi ?? previous.multi ?? false,
		allow_other: input.allow_other ?? previous.allow_other ?? false,
	});
}

// Validates the fields present in the request and returns them as column values.
function parseFields(input: Input, existing: ItemRow | null): Record<string, unknown> {
	const cols: Record<string, unknown> = {};
	const bad = (message: string, topic = "items") => new ApiError(400, message, topic);
	const { type, title, body, tags, key, author, blocked, priority, pinned, links } = input;
	const finalType = (type ?? existing?.type) as string;

	if (type !== undefined) {
		if (!ITEM_TYPES.includes(type as never)) throw bad(`type must be one of: ${ITEM_TYPES.join(", ")}`);
		cols.type = type;
	}
	if (title !== undefined) {
		if (!isString(title, 200) || !title.trim())
			throw bad("title must be a non-empty string of at most 200 characters");
		cols.title = title.trim();
	}
	if (body !== undefined) {
		if (!isString(body, 20000)) throw bad("body must be a string of at most 20000 characters");
		cols.body = body;
	}
	if (tags !== undefined) {
		if (!Array.isArray(tags) || tags.length > 20 || tags.some((tag) => !isString(tag, 100)))
			throw bad("tags must be an array of at most 20 strings");
		cols.tags = JSON.stringify(tags);
	}
	if (key !== undefined) {
		if (key !== null && !(typeof key === "string" && KEY_PATTERN.test(key)))
			throw bad("key must be 1 to 100 characters from letters, digits and . _ : -", "keys");
		cols.key = key;
	}
	if (author !== undefined) {
		if (author !== null && !isString(author, 100)) throw bad("author must be a string of at most 100 characters");
		cols.author = author || null;
	}
	if (blocked !== undefined) {
		if (blocked !== null && !isString(blocked, 500))
			throw bad("blocked must be a reason of at most 500 characters, or null to clear it");
		cols.blocked = blocked || null;
	}
	if (priority !== undefined) {
		if (!Number.isInteger(priority) || Math.abs(priority as number) > 1000)
			throw bad("priority must be an integer between -1000 and 1000");
		cols.priority = priority;
	}
	if (pinned !== undefined) {
		if (typeof pinned !== "boolean") throw bad("pinned must be true or false");
		cols.pinned = pinned ? 1 : 0;
	}
	if (links !== undefined) {
		if (
			!Array.isArray(links) ||
			links.length > 10 ||
			links.some((link) => !link || !isString(link.label, 100) || !link.label || !isHttpUrl(link.url))
		)
			throw bad('links must be at most 10 of {"label": "...", "url": "https://..."}');
		cols.links = JSON.stringify(links.map((link) => ({ label: link.label, url: link.url })));
	}
	if (input.resolved !== undefined) {
		if (typeof input.resolved !== "boolean") throw bad("resolved must be true or false");
		if (finalType !== "question" && finalType !== "blocker")
			throw bad("resolved applies to question and blocker items only");
		cols.resolved_at = input.resolved ? (existing?.resolved_at ?? now()) : null;
	}
	if (input.made_by !== undefined) {
		if (input.made_by !== null && !MADE_BY.includes(input.made_by as never))
			throw bad(`made_by must be one of: ${MADE_BY.join(", ")}`, "decisions");
		cols.made_by = input.made_by;
	}
	if (input.needs_review !== undefined) {
		if (typeof input.needs_review !== "boolean") throw bad("needs_review must be true or false", "decisions");
		cols.needs_review = input.needs_review ? 1 : 0;
	}
	if (input.options !== undefined || input.multi !== undefined || input.allow_other !== undefined) {
		if (finalType !== "question") throw bad("options apply to question items only", "questions");
		cols.question = parseOptions(input, existing);
	}
	if (input.unarchive === true && existing) cols.archived_at = null;
	return cols;
}

function resolveProject(agent: Agent, slug: unknown, topic = "items"): Project {
	const project =
		slug === undefined && agent.projects.length === 1
			? agent.projects[0]
			: agent.projects.find((p) => p.slug === slug);
	if (!project)
		throw new ApiError(
			400,
			`project must be one of your projects: ${agent.projects.map((p) => p.slug).join(", ")}`,
			topic,
		);
	return project;
}

const loadItem = (id: number) => first<ItemRow>(`${ITEM_SELECT} WHERE i.id = ?`, id);

const findByKey = (agent: Agent, project: Project, key: string) =>
	first<ItemRow>(
		`${ITEM_SELECT} WHERE i.key_id = ? AND i.project_id = ? AND i.key = ?`,
		agent.keyId,
		project.id,
		key,
	);

async function createItem(agent: Agent, project: Project, cols: Record<string, unknown>) {
	if (cols.type === undefined || cols.title === undefined)
		throw new ApiError(400, "type and title are required", "items");
	const at = now();
	const row: Record<string, unknown> = {
		project_id: project.id,
		key_id: agent.keyId,
		agent: agent.name,
		...cols,
		created_at: at,
		updated_at: at,
	};
	const names = Object.keys(row);
	const created = await first<{ id: number }>(
		`INSERT INTO items (${names.join(", ")}) VALUES (${marks(names)}) RETURNING id`,
		...Object.values(row),
	);
	return (await loadItem(created!.id))!;
}

async function updateItem(item: ItemRow, cols: Record<string, unknown>) {
	const at = now();
	const changed = (["type", "title", "body"] as const).some(
		(name) => cols[name] !== undefined && cols[name] !== item[name],
	);
	if (changed)
		await run(
			"INSERT INTO item_history (item_id, type, title, body, changed_at) VALUES (?, ?, ?, ?, ?)",
			item.id,
			item.type,
			item.title,
			item.body,
			at,
		);
	const row = { ...cols, updated_at: at };
	try {
		await run(
			`UPDATE items SET ${Object.keys(row)
				.map((name) => `${name} = ?`)
				.join(", ")} WHERE id = ?`,
			...Object.values(row),
			item.id,
		);
	} catch (error) {
		if (String(error).includes("UNIQUE"))
			throw new ApiError(409, `You already have an item with the key "${cols.key}" in this project`, "keys");
		throw error;
	}
	return (await loadItem(item.id))!;
}

async function readJson(c: Ctx, topic = "items"): Promise<Input> {
	const value = await c.req.json().catch(() => null);
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new ApiError(400, "Body must be a JSON object", topic);
	return value;
}

async function findItem(c: Ctx, topic = "items"): Promise<ItemRow> {
	const id = Number(c.req.param("id"));
	const ids = c.get("agent").projects.map((p) => p.id);
	const item =
		Number.isInteger(id) && ids.length
			? await first<ItemRow>(`${ITEM_SELECT} WHERE i.id = ? AND i.project_id IN (${marks(ids)})`, id, ...ids)
			: null;
	if (!item) throw new ApiError(404, "No such item in your projects", topic);
	return item;
}

export const api = new Hono<Vars>();

api.onError((error, c) => {
	if (error instanceof ApiError)
		return c.json(
			{
				error: error.message,
				help: `${base(c)}/api/help${error.topic && `/${error.topic}`}`,
				...error.extra,
			},
			error.status,
		);
	console.error(error);
	return c.json({ error: "Internal error", help: `${base(c)}/api/help` }, 500);
});

api.get("/", (c) => c.text(helpIndex(base(c))));
api.get("/help", (c) => c.text(helpIndex(base(c))));
api.get("/help/:topic", (c) => {
	const text = helpTopic(c.req.param("topic"), base(c));
	return text ? c.text(text) : c.text(`Unknown topic.\n\n${helpIndex(base(c))}`, 404);
});

api.use("*", async (c, next) => {
	const token = c.req.header("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
	if (!token) throw new ApiError(401, "Missing Authorization: Bearer <key> header", "auth");
	const key = await first<{ id: number; agent: string; last_used_at: string | null; seen_version: number }>(
		"SELECT id, agent, last_used_at, seen_version FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL",
		await sha256(token),
	);
	if (!key) throw new ApiError(401, "Unknown or revoked API key", "auth");

	if (c.req.method !== "GET") {
		const minute = Math.floor(Date.now() / 60_000);
		const usage = await first<{ count: number }>(
			`INSERT INTO rate_limits (key_id, minute, count) VALUES (?, ?, 1)
			 ON CONFLICT (key_id, minute) DO UPDATE SET count = count + 1 RETURNING count`,
			key.id,
			minute,
		);
		c.executionCtx.waitUntil(run("DELETE FROM rate_limits WHERE key_id = ? AND minute < ?", key.id, minute));
		if (usage!.count > WRITES_PER_MINUTE)
			throw new ApiError(429, `Rate limit: at most ${WRITES_PER_MINUTE} writes per minute per key`, "limits", {
				retry_after: 60 - (Math.floor(Date.now() / 1000) % 60),
			});
	}

	const projects = await all<Project>(
		"SELECT p.id, p.slug FROM projects p JOIN key_projects kp ON kp.project_id = p.id WHERE kp.key_id = ?",
		key.id,
	);
	c.set("agent", {
		keyId: key.id,
		name: key.agent,
		projects,
		lastSeen: key.last_used_at,
		seenVersion: key.seen_version,
	});
	// Any authenticated call is a sign of life.
	c.executionCtx.waitUntil(run("UPDATE api_keys SET last_used_at = ? WHERE id = ?", now(), key.id));
	await next();
});

api.get("/me", async (c) => {
	const agent = c.get("agent");
	const statuses = await all<{ project: string; status: string; stale_after_minutes: number; status_at: string }>(
		`SELECT p.slug AS project, s.status, s.stale_after_minutes, s.status_at
		 FROM agent_status s JOIN projects p ON p.id = s.project_id WHERE s.key_id = ?`,
		agent.keyId,
	);
	return c.json({
		agent: agent.name,
		projects: agent.projects.map((p) => p.slug),
		last_seen: agent.lastSeen,
		heartbeats: statuses,
		api_version: LATEST_VERSION,
	});
});

api.post("/heartbeat", async (c) => {
	const agent = c.get("agent");
	const input = await c.req.json<Input>().catch(() => ({}) as Input);
	const { status, stale_after_minutes: minutes } = input;
	if (status !== undefined && !isString(status, 200))
		throw new ApiError(400, "status must be a string of at most 200 characters", "heartbeat");
	if (minutes !== undefined && !(Number.isInteger(minutes) && (minutes as number) >= 1 && (minutes as number) <= 10080))
		throw new ApiError(400, "stale_after_minutes must be an integer from 1 to 10080", "heartbeat");
	const projects = input.project === undefined ? agent.projects : [resolveProject(agent, input.project, "heartbeat")];
	const at = now();
	for (const project of projects)
		await run(
			`INSERT INTO agent_status (key_id, project_id, status, stale_after_minutes, status_at)
			 VALUES (?1, ?2, COALESCE(?3, ''), COALESCE(?4, 120), ?5)
			 ON CONFLICT (key_id, project_id) DO UPDATE SET
			   status = COALESCE(?3, status), stale_after_minutes = COALESCE(?4, stale_after_minutes), status_at = ?5`,
			agent.keyId,
			project.id,
			status ?? null,
			minutes ?? null,
			at,
		);
	return c.json({ ok: true, at, projects: projects.map((p) => p.slug) });
});

api.post("/items", async (c) => {
	const agent = c.get("agent");
	const input = await readJson(c);
	const project = resolveProject(agent, input.project);
	// A key that already exists makes the post an update, so retries are safe.
	const existing = typeof input.key === "string" ? await findByKey(agent, project, input.key) : null;
	const cols = parseFields(input, existing);
	if (existing) return c.json(itemJson(await updateItem(existing, cols)));
	return c.json(itemJson(await createItem(agent, project, cols)), 201);
});

api.get("/items", async (c) => {
	const agent = c.get("agent");
	const q = c.req.query();
	const projects = q.project ? [resolveProject(agent, q.project)] : agent.projects;
	if (!projects.length) return c.json({ items: [] });
	if (q.type && !ITEM_TYPES.includes(q.type as never))
		throw new ApiError(400, `type must be one of: ${ITEM_TYPES.join(", ")}`, "items");

	const ids = projects.map((p) => p.id);
	const where = [`i.project_id IN (${marks(ids)})`];
	const params: unknown[] = [...ids];
	if (q.type) where.push("i.type = ?"), params.push(q.type);
	if (q.mine === "true") where.push("i.key_id = ?"), params.push(agent.keyId);
	if (q.key) where.push("i.key = ?"), params.push(q.key);
	if (q.key_prefix) where.push("substr(i.key, 1, ?) = ?"), params.push(q.key_prefix.length, q.key_prefix);
	if (q.archived !== "true") where.push("i.archived_at IS NULL");
	const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);

	const rows = await all<ItemRow>(
		`${ITEM_SELECT} WHERE ${where.join(" AND ")} ${ITEM_ORDER} LIMIT ?`,
		...params,
		limit,
	);
	return c.json({ items: rows.map(itemJson) });
});

function keyParam(c: Ctx): string {
	const key = c.req.param("key") ?? "";
	if (!KEY_PATTERN.test(key))
		throw new ApiError(400, "key must be 1 to 100 characters from letters, digits and . _ : -", "keys");
	return key;
}

api.get("/items/by-key/:key", async (c) => {
	const agent = c.get("agent");
	const project = resolveProject(agent, c.req.query("project"), "keys");
	const item = await findByKey(agent, project, keyParam(c));
	if (!item) throw new ApiError(404, "You have no item with that key in this project", "keys");
	return c.json(itemJson(item));
});

api.put("/items/by-key/:key", async (c) => {
	const agent = c.get("agent");
	const key = keyParam(c);
	const input = await readJson(c, "keys");
	const project = resolveProject(agent, input.project ?? c.req.query("project"), "keys");
	const existing = await findByKey(agent, project, key);
	const cols = parseFields({ ...input, key }, existing);
	if (existing) return c.json(itemJson(await updateItem(existing, cols)));
	return c.json(itemJson(await createItem(agent, project, cols)), 201);
});

api.get("/items/:id", async (c) => {
	const item = await findItem(c);
	const comments = await all<CommentRow>("SELECT * FROM comments WHERE item_id = ? ORDER BY created_at", item.id);
	const history =
		c.req.query("history") === "true"
			? await all("SELECT type, title, body, changed_at FROM item_history WHERE item_id = ? ORDER BY changed_at", item.id)
			: undefined;
	return c.json({
		...itemJson(item),
		comments: comments.map((m) => ({
			id: m.id,
			author: m.author_kind === "user" ? "user" : m.author,
			body: m.body,
			created_at: m.created_at,
			needs_reply: !!m.needs_reply,
		})),
		history,
	});
});

api.patch("/items/:id", async (c) => {
	const item = await findItem(c);
	if (item.key_id !== c.get("agent").keyId) throw new ApiError(403, "You can only update items you posted", "auth");
	return c.json(itemJson(await updateItem(item, parseFields(await readJson(c), item))));
});

api.post("/items/:id/comments", async (c) => {
	const item = await findItem(c, "comments");
	const { body, author } = await readJson(c, "comments");
	if (!isString(body, 20000) || !body.trim())
		throw new ApiError(400, "body must be a non-empty string of at most 20000 characters", "comments");
	if (author !== undefined && !isString(author, 100))
		throw new ApiError(400, "author must be a string of at most 100 characters", "comments");
	const agent = c.get("agent");
	const at = now();
	const row = await first<{ id: number }>(
		`INSERT INTO comments (item_id, author_kind, author, body, created_at)
		 VALUES (?, 'agent', ?, ?, ?) RETURNING id`,
		item.id,
		author ? `${agent.name} / ${author}` : agent.name,
		body,
		at,
	);
	return c.json({ id: row!.id, item_id: item.id, body, created_at: at }, 201);
});

function summaryJson(row: { headline: string; fields: string; updated_at: string } | null, project: string) {
	return {
		project,
		headline: row?.headline ?? "",
		fields: row ? JSON.parse(row.fields) : {},
		updated_at: row?.updated_at ?? null,
	};
}

const loadSummary = (agent: Agent, project: Project) =>
	first<{ headline: string; fields: string; updated_at: string }>(
		"SELECT headline, fields, updated_at FROM summaries WHERE key_id = ? AND project_id = ?",
		agent.keyId,
		project.id,
	);

api.get("/projects/:slug/summary", async (c) => {
	const agent = c.get("agent");
	const project = resolveProject(agent, c.req.param("slug"), "summary");
	return c.json(summaryJson(await loadSummary(agent, project), project.slug));
});

// PUT replaces the summary; PATCH merges fields and removes those set to null.
api.on(["PUT", "PATCH"], "/projects/:slug/summary", async (c) => {
	const agent = c.get("agent");
	const project = resolveProject(agent, c.req.param("slug"), "summary");
	const input = await readJson(c, "summary");
	const merge = c.req.method === "PATCH";
	const current = merge ? summaryJson(await loadSummary(agent, project), project.slug) : null;

	if (input.headline !== undefined && !isString(input.headline, 300))
		throw new ApiError(400, "headline must be a string of at most 300 characters", "summary");
	const given = input.fields ?? {};
	if (typeof given !== "object" || Array.isArray(given))
		throw new ApiError(400, "fields must be an object", "summary");
	const fields: Record<string, unknown> = { ...current?.fields };
	for (const [name, value] of Object.entries(given as Input)) {
		if (value === null) delete fields[name];
		else if (name.length <= 50 && (isString(value, 200) || typeof value === "number" || typeof value === "boolean"))
			fields[name] = value;
		else
			throw new ApiError(400, "field names are at most 50 characters; values are strings (at most 200), numbers or booleans", "summary");
	}
	if (Object.keys(fields).length > 20) throw new ApiError(400, "At most 20 fields", "summary");

	const at = now();
	await run(
		`INSERT INTO summaries (key_id, project_id, headline, fields, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
		 ON CONFLICT (key_id, project_id) DO UPDATE SET headline = ?3, fields = ?4, updated_at = ?5`,
		agent.keyId,
		project.id,
		input.headline ?? current?.headline ?? "",
		JSON.stringify(fields),
		at,
	);
	return c.json(summaryJson(await loadSummary(agent, project), project.slug));
});

// Messages addressed to this key, or to every agent in one of its projects.
function inboxQuery(agent: Agent, unreadOnly: boolean, since = 0) {
	const ids = agent.projects.map((p) => p.id);
	const sql = `FROM messages m
		JOIN projects p ON p.id = m.project_id
		LEFT JOIN items i ON i.id = m.item_id
		LEFT JOIN message_acks a ON a.message_id = m.id AND a.key_id = ?
		WHERE m.project_id IN (${marks(ids)}) AND (m.key_id = ? OR m.key_id IS NULL) AND m.id > ?
		${unreadOnly ? "AND a.message_id IS NULL" : ""}`;
	return { sql, params: [agent.keyId, ...ids, agent.keyId, since] };
}

// Puts changelog entries the key has not been told about into its inbox.
async function deliverChanges(c: Ctx, agent: Agent) {
	if (agent.seenVersion >= LATEST_VERSION) return;
	const claimed = await run(
		"UPDATE api_keys SET seen_version = ? WHERE id = ? AND seen_version < ?",
		LATEST_VERSION,
		agent.keyId,
		LATEST_VERSION,
	);
	if (!claimed.meta.changes) return;
	for (const change of CHANGES.filter((entry) => entry.version > agent.seenVersion).reverse())
		await run(
			"INSERT INTO messages (project_id, key_id, kind, body, data, created_at) VALUES (?, ?, 'changes', ?, ?, ?)",
			agent.projects[0].id,
			agent.keyId,
			changesText(change.version, base(c)),
			JSON.stringify({ version: change.version }),
			now(),
		);
}

api.get("/inbox", async (c) => {
	const agent = c.get("agent");
	if (!agent.projects.length) return c.json({ messages: [] });
	await deliverChanges(c, agent);

	const q = c.req.query();
	const { sql, params } = inboxQuery(agent, q.all !== "true", Math.max(Number(q.since) || 0, 0));
	const load = () =>
		all<{
			id: number;
			kind: string;
			project: string;
			item_id: number | null;
			item_title: string | null;
			item_key: string | null;
			body: string;
			data: string | null;
			created_at: string;
			acked_at: string | null;
		}>(
			`SELECT m.id, m.kind, p.slug AS project, m.item_id, i.title AS item_title, i.key AS item_key,
			        m.body, m.data, m.created_at, a.acked_at ${sql} ORDER BY m.id LIMIT 200`,
			...params,
		);

	// Long poll: hold the request until something arrives or the wait runs out.
	const deadline = Date.now() + Math.min(Math.max(Number(q.wait) || 0, 0), 25) * 1000;
	let rows = await load();
	while (!rows.length && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 2000));
		rows = await load();
	}
	return c.json({
		messages: rows.map(({ acked_at, data, ...message }) => ({
			...message,
			...(data ? JSON.parse(data) : {}),
			read: acked_at !== null,
		})),
	});
});

api.post("/inbox/ack", async (c) => {
	const agent = c.get("agent");
	const input = await readJson(c, "inbox");
	const everything = input.all === true;
	const ids = input.ids as number[];
	if (!everything && !(Array.isArray(ids) && ids.every((id) => Number.isInteger(id))))
		throw new ApiError(400, 'Send {"ids":[1,2]} or {"all":true}', "inbox");
	if (!everything && ids.length > 50) throw new ApiError(400, "Acknowledge at most 50 ids per call", "inbox");
	if (!agent.projects.length || (!everything && !ids.length)) return c.json({ acknowledged: 0 });

	const { sql, params } = inboxQuery(agent, true);
	const result = await run(
		`INSERT INTO message_acks (message_id, key_id, acked_at) SELECT m.id, ?, ? ${sql}
		 ${everything ? "" : `AND m.id IN (${marks(ids)})`}`,
		agent.keyId,
		now(),
		...params,
		...(everything ? [] : ids),
	);
	return c.json({ acknowledged: result.meta.changes });
});

api.all("*", (c) => {
	throw new ApiError(404, `No such endpoint: ${c.req.method} ${c.req.path}`);
});
