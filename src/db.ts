import { env } from "cloudflare:workers";

export const now = () => new Date().toISOString();

export async function all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
	const { results } = await env.DB.prepare(sql)
		.bind(...params)
		.all<T>();
	return results;
}

export function first<T>(sql: string, ...params: unknown[]): Promise<T | null> {
	return env.DB.prepare(sql)
		.bind(...params)
		.first<T>();
}

export function run(sql: string, ...params: unknown[]) {
	return env.DB.prepare(sql)
		.bind(...params)
		.run();
}

export async function sha256(text: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type ItemRow = {
	id: number;
	project_id: number;
	project: string;
	key_id: number;
	agent: string;
	type: string;
	title: string;
	body: string;
	tags: string;
	created_at: string;
	updated_at: string;
	archived_at: string | null;
	key: string | null;
	author: string | null;
	blocked: string | null;
	resolved_at: string | null;
	priority: number;
	pinned: number;
	links: string;
	question: string | null;
	answer: string | null;
	made_by: string | null;
	needs_review: number;
	review: string | null;
	seen_at: string | null;
};

export type CommentRow = {
	id: number;
	item_id: number;
	author_kind: "user" | "agent";
	author: string;
	body: string;
	created_at: string;
	needs_reply: number;
};

export const ITEM_SELECT = `SELECT i.*, p.slug AS project FROM items i JOIN projects p ON p.id = i.project_id`;

// "?,?,?" for an IN (...) clause.
export const marks = (values: unknown[]) => values.map(() => "?").join(",");

// Pinned first, then priority, then newest.
export const ITEM_ORDER = "ORDER BY i.pinned DESC, i.priority DESC, i.updated_at DESC";
