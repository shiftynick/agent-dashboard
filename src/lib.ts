// Pure helpers shared by the API and the UI. No runtime imports, so the
// tests can load this file directly in Node.

export const DEFAULT_STALE_MINUTES = 120;

export function isStale(lastAt: string | null, minutes: number, nowMs = Date.now()): boolean {
	return lastAt === null || nowMs - Date.parse(lastAt) > minutes * 60_000;
}

type Stage = {
	type: string;
	archived_at: string | null;
	resolved_at: string | null;
	answer: string | null;
	blocked: string | null;
	needs_review: number;
};

// True while the item is waiting on the owner.
export function needsOwner(item: Stage): boolean {
	if (item.archived_at) return false;
	if (item.blocked || item.needs_review) return true;
	return (item.type === "question" || item.type === "blocker") && !item.resolved_at && !item.answer;
}

export const GROUPS = [
	["needs", "Needs you"],
	["working_on", "Working on"],
	["waiting", "Waiting"],
	["upcoming", "Upcoming"],
	["decision", "Decisions"],
	["done", "Done"],
	["note", "Notes"],
	["settled", "Answered and resolved"],
] as const;

export function groupOf(item: Stage): string {
	if (needsOwner(item)) return "needs";
	return item.type === "question" || item.type === "blocker" ? "settled" : item.type;
}

const escapeHtml = (text: string) =>
	text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");

// Inline markdown over text that is already HTML-escaped. Code spans and
// links are swapped for placeholders so later rules cannot touch them.
function inline(text: string): string {
	const held: string[] = [];
	const hold = (html: string) => `\u0000${held.push(html) - 1}\u0000`;
	const link = (url: string, label: string) =>
		hold(`<a href="${url}" rel="noopener noreferrer" target="_blank">${label}</a>`);
	return text
		.replace(/`([^`\n]+)`/g, (_, code) => hold(`<code>${code}</code>`))
		.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => link(url, label))
		.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (url) => link(url, url))
		.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
		.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>")
		.replace(/\u0000(\d+)\u0000/g, (_, index) => held[Number(index)]);
}

// A small markdown subset: headings, lists, fenced code, bold, italic, inline
// code and http(s) links. Everything is escaped first, so raw HTML, images
// and other URL schemes come out as plain text.
export function renderMarkdown(source: string): string {
	const lines = escapeHtml(source.replaceAll("\u0000", "")).split(/\r?\n/);
	const out: string[] = [];
	let paragraph: string[] = [];
	let list: { tag: string; items: string[] } | null = null;
	let code: string[] | null = null;

	const flush = () => {
		if (paragraph.length) out.push(`<p>${paragraph.map(inline).join("<br>")}</p>`);
		if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`);
		paragraph = [];
		list = null;
	};

	for (const line of lines) {
		if (code) {
			if (line.startsWith("```")) {
				out.push(`<pre class="code">${code.join("\n")}</pre>`);
				code = null;
			} else code.push(line);
			continue;
		}
		const heading = line.match(/^(#{1,3})\s+(.*)$/);
		const item = line.match(/^\s*(?:([-*])|\d+\.)\s+(.*)$/);
		if (line.startsWith("```")) {
			flush();
			code = [];
		} else if (heading) {
			flush();
			out.push(`<h4>${inline(heading[2])}</h4>`);
		} else if (item) {
			const tag = item[1] ? "ul" : "ol";
			if (paragraph.length || (list && list.tag !== tag)) flush();
			list ??= { tag, items: [] };
			list.items.push(item[2]);
		} else if (!line.trim()) {
			flush();
		} else {
			if (list) flush();
			paragraph.push(line);
		}
	}
	if (code) out.push(`<pre class="code">${code.join("\n")}</pre>`);
	flush();
	return out.join("");
}
