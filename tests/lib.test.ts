import assert from "node:assert/strict";
import { test } from "node:test";
import { groupOf, isStale, needsOwner, renderMarkdown } from "../src/lib.ts";

const item = (over: object) => ({
	type: "note",
	archived_at: null,
	resolved_at: null,
	answer: null,
	blocked: null,
	needs_review: 0,
	...over,
});

test("markdown never emits markup from item content", () => {
	const html = renderMarkdown(
		'<script>alert(1)</script>\n<img src=x onerror="alert(2)">\n[click](javascript:alert(3))\n![pic](https://example.com/a.png)',
	);
	assert.ok(!html.includes("<script"));
	assert.ok(!html.includes("<img"));
	assert.ok(!/<[^>]+onerror/i.test(html));
	assert.ok(!/href="javascript:/i.test(html));
	assert.ok(html.includes("&lt;script&gt;"));
});

test("markdown renders the supported subset", () => {
	const html = renderMarkdown("# Title\n\nSome **bold** and `code`.\n\n- one\n- two\n\n[site](https://example.com/a?b=1&c=2)");
	assert.ok(html.includes("<h4>Title</h4>"));
	assert.ok(html.includes("<strong>bold</strong>"));
	assert.ok(html.includes("<code>code</code>"));
	assert.ok(html.includes("<ul><li>one</li><li>two</li></ul>"));
	assert.ok(html.includes('<a href="https://example.com/a?b=1&amp;c=2" rel="noopener noreferrer" target="_blank">site</a>'));
});

test("markdown link text and code cannot break out of their tags", () => {
	const html = renderMarkdown('[a"onmouseover="x](https://example.com/"onclick="y) `</code><b>`');
	// Every tag is one the renderer wrote, with only the attributes it sets.
	for (const tag of html.match(/<[^>]*>/g) ?? [])
		assert.match(tag, /^<(\/?(p|code|a)|a href="[^"]*" rel="noopener noreferrer" target="_blank")>$/, tag);
	assert.ok(html.includes("&quot;onclick=&quot;y"));
});

test("an agent is stale once it has been silent longer than its threshold", () => {
	const now = Date.parse("2026-10-05T12:00:00Z");
	assert.equal(isStale("2026-10-05T11:59:30Z", 1, now), false);
	assert.equal(isStale("2026-10-05T11:58:00Z", 1, now), true);
	assert.equal(isStale("2026-10-05T10:30:00Z", 120, now), false);
	assert.equal(isStale(null, 120, now), true);
});

test("needs-owner covers open questions, blockers, blocked items and decisions to review", () => {
	assert.equal(needsOwner(item({ type: "question" })), true);
	assert.equal(needsOwner(item({ type: "question", answer: "{}" })), false);
	assert.equal(needsOwner(item({ type: "blocker", resolved_at: "x" })), false);
	assert.equal(needsOwner(item({ type: "working_on", blocked: "waiting for access" })), true);
	assert.equal(needsOwner(item({ type: "decision", needs_review: 1 })), true);
	assert.equal(needsOwner(item({ type: "question", archived_at: "x" })), false);
	assert.equal(groupOf(item({ type: "blocker", resolved_at: "x" })), "settled");
	assert.equal(groupOf(item({ type: "waiting" })), "waiting");
});
