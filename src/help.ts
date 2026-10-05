// Single source for the API documentation: served at /api/help and written
// to docs/API.md by scripts/gen-docs.ts. Keep this file free of runtime imports.

export const ITEM_TYPES = [
	"upcoming",
	"working_on",
	"waiting",
	"done",
	"decision",
	"blocker",
	"question",
	"note",
] as const;

export const MADE_BY = ["owner", "orchestrator", "worker", "reviewer"] as const;

export const WRITES_PER_MINUTE = 120;

// Newest first. Adding an entry with a higher version delivers it to every
// agent's inbox as a "changes" message the next time that agent checks in.
export const CHANGES: { version: number; date: string; items: string[] }[] = [
	{
		version: 2,
		date: "2026-10-05",
		items: [
			"Item keys: give an item a key of your choosing and create-or-update it with PUT /api/items/by-key/:key, so you never need to remember item ids. See help/keys.",
			"Answerable questions: a question can carry options the user taps; the answer arrives in your inbox as kind \"answer\". See help/questions.",
			"New item types: upcoming (planned) and waiting (finished, not live yet).",
			"New item fields: blocked, resolved, priority, pinned, links, author, made_by, needs_review. See help/items and help/decisions.",
			"The inbox now also reports what the user did: kinds archived, unarchived, resolved, reopened, answer, review, changes. See help/inbox.",
			"Faster feedback: GET /api/inbox?wait=25 holds the request until a message arrives; ?since=<id> polls cheaply. Comments can carry needs_reply.",
			"Heartbeat and status line: POST /api/heartbeat. See help/heartbeat.",
			"Project summary: a headline and key-value facts you overwrite in place. See help/summary.",
			"Item bodies render as markdown. Writes are limited per key. See help/limits.",
			"Archiving is no longer silent, and updating an archived item keeps it archived unless you send unarchive: true.",
		],
	},
	{
		version: 1,
		date: "2026-10-05",
		items: ["First release: items, comments, inbox, help."],
	},
];

export const LATEST_VERSION = CHANGES[0].version;

export function changesText(version: number, base: string): string {
	const change = CHANGES.find((c) => c.version === version)!;
	return `The Agent Dashboard API changed (version ${version}). Existing calls still work.\n\n${change.items
		.map((item) => `- ${item}`)
		.join("\n")}\n\nDetails: ${base}/api/help/changes`;
}

export const TOPICS: Record<string, { summary: string; body: string }> = {
	auth: {
		summary: "How to authenticate and what your key can see",
		body: `Every request except /api/help needs your key:

    Authorization: Bearer $AGENT_DASHBOARD_KEY

A key is one agent identity, scoped to one or more projects. You can read
everything in your projects, and change only the items you posted.

    curl -s {BASE}/api/me -H "Authorization: Bearer $AGENT_DASHBOARD_KEY"

returns your agent name, project slugs, when you were last seen, your status
line per project and the API version.`,
	},
	items: {
		summary: "Post and update what you are working on, done, decided or blocked on",
		body: `An item is one thing the user should know. Types:

    upcoming    planned, not started
    working_on  a task in progress
    waiting     finished, waiting on something before it is live (say what in the body)
    done        a finished task
    decision    a choice you made and why
    blocker     something stopping you
    question    something you need the user to answer
    note        anything else

Create:

    curl -s -X POST {BASE}/api/items \\
      -H "Authorization: Bearer $AGENT_DASHBOARD_KEY" \\
      -H "Content-Type: application/json" \\
      -d '{"project":"my-project","type":"working_on","title":"Add login page","body":"optional markdown","tags":["auth"]}'

"project" may be omitted when your key has exactly one project.

Response (201) is the item. Create, update and read all return this shape:

    {"id":123,"key":null,"project":"my-project","agent":"you","author":null,
     "type":"working_on","title":"...","body":"...","tags":[],"links":[],
     "priority":0,"pinned":false,"blocked":null,"resolved":false,"resolved_at":null,
     "made_by":null,"needs_review":false,"review":null,
     "options":null,"multi":false,"allow_other":false,"answer":null,
     "created_at":"...","updated_at":"...","archived":false,"seen_by_owner":false}

Fields you can set on create and update (all optional except type and title on create):

    type       one of the types above
    title      at most 200 characters
    body       markdown, at most 20000 characters. Raw HTML and images are shown as text.
    tags       up to 20 strings
    key        your own name for the item, see help/keys
    links      up to 10 of {"label":"PR 12","url":"https://..."}, shown as buttons
    priority   integer, higher is listed first, default 0
    pinned     true lists the item before everything else in its group
    blocked    a short reason; the item keeps its type but is shown under "Needs you".
               Send null to clear it.
    resolved   true or false, for question and blocker items: dealt with, but still visible
    author     who wrote this, when several workers share one key (e.g. "worker-3")
    made_by, needs_review   see help/decisions
    options, multi, allow_other   see help/questions

Update one of your own items with any subset of those fields:

    curl -s -X PATCH {BASE}/api/items/123 \\
      -H "Authorization: Bearer $AGENT_DASHBOARD_KEY" \\
      -H "Content-Type: application/json" \\
      -d '{"type":"done"}'

An item the user archived stays archived when you update it (the response has
"archived": true). Send "unarchive": true only if it really needs their
attention again.

List (pinned first, then priority, then most recently updated):

    GET /api/items?project=my-project&type=done&mine=true&limit=50

    project     slug; defaults to all your projects
    type        one of the types above
    mine        true = only items you posted
    key         exact item key
    key_prefix  items whose key starts with this, e.g. issue-
    archived    true = include items the user has archived (hidden by default)
    limit       1-200, default 50

Read one item with its comment thread:

    GET /api/items/123
    GET /api/items/123?history=true   also returns earlier type, title and body

seen_by_owner is true once the user has had the current version on screen.`,
	},
	keys: {
		summary: "Name items yourself and create-or-update them, so restarts never duplicate",
		body: `Give an item a key that means something to you, such as "issue-201" or
"note-upcoming". Keys are unique per agent and project, up to 100 characters
from letters, digits and . _ : -

Create the item, or update it if it exists (same fields as help/items):

    curl -s -X PUT {BASE}/api/items/by-key/issue-201 \\
      -H "Authorization: Bearer $AGENT_DASHBOARD_KEY" \\
      -H "Content-Type: application/json" \\
      -d '{"type":"working_on","title":"Fix login redirect","links":[{"label":"ODE-201","url":"https://example.com/ODE-201"}]}'

Returns 201 with the new item, or 200 with the updated one. type and title are
required only when the item does not exist yet. With more than one project,
put "project" in the body or add ?project=slug.

Read it back:

    GET /api/items/by-key/issue-201

This makes posting safe to retry: the same PUT twice leaves one item. POST
/api/items with a "key" that already exists also updates instead of
duplicating. Another agent using the same key gets its own item.

Find items by key:

    GET /api/items?key=issue-201
    GET /api/items?key_prefix=issue-`,
	},
	questions: {
		summary: "Ask the user a question they can answer with one tap",
		body: `A question item may carry options. The user sees them as buttons and the
answer comes back as data, not prose.

    curl -s -X PUT {BASE}/api/items/by-key/q-database \\
      -H "Authorization: Bearer $AGENT_DASHBOARD_KEY" \\
      -H "Content-Type: application/json" \\
      -d '{"type":"question","title":"Which database?","options":[
            {"id":"d1","label":"D1","description":"SQL, free","recommended":true},
            {"id":"kv","label":"KV","description":"Key-value only"}],
           "multi":false,"allow_other":true}'

    options      2 to 10 of {id, label, description?, recommended?}
    multi        true lets the user pick several
    allow_other  true adds a free-text answer

The answer arrives in your inbox (help/inbox) as kind "answer":

    {"id":9,"kind":"answer","item_id":123,"item_key":"q-database",
     "selected":["d1"],"text":"","body":"Answer: D1", ...}

and GET /api/items/123 shows it under "answer". An answered question stops
counting as waiting on the user. If the user changes the answer you get a new
"answer" message; the latest one wins.

A question without options still works: the user replies with a comment.`,
	},
	decisions: {
		summary: "Record who decided, and flag decisions the user may want to overrule",
		body: `On a decision item:

    made_by       one of: owner, orchestrator, worker, reviewer
    needs_review  true for a decision made on the user's behalf that changes
                  what users see or what is counted

    curl -s -X POST {BASE}/api/items \\
      -H "Authorization: Bearer $AGENT_DASHBOARD_KEY" \\
      -H "Content-Type: application/json" \\
      -d '{"type":"decision","title":"Round prices up","made_by":"orchestrator","needs_review":true}'

The user answers with "Fine" or "Overrule" and an optional comment. You get
an inbox message of kind "review":

    {"kind":"review","item_id":124,"item_key":null,"verdict":"overruled","comment":"Round to nearest", ...}

verdict is "accepted" or "overruled". The flag is cleared and the item's
"review" field keeps the verdict.`,
	},
	comments: {
		summary: "Reply on an item's thread",
		body: `The user can comment on any item. Reply on the same thread:

    curl -s -X POST {BASE}/api/items/123/comments \\
      -H "Authorization: Bearer $AGENT_DASHBOARD_KEY" \\
      -H "Content-Type: application/json" \\
      -d '{"body":"Switched to the approach you suggested.","author":"worker-3"}'

"author" is optional. GET /api/items/123 returns the full thread. A comment
from the user with "needs_reply": true is an instruction or a question, not
just a remark: act on it and reply.`,
	},
	inbox: {
		summary: "Read feedback, answers and actions from the user",
		body: `The inbox holds what the user said and did. Unread state is tracked per key
on the server, so a new session sees everything it missed.

    curl -s {BASE}/api/inbox -H "Authorization: Bearer $AGENT_DASHBOARD_KEY"

Every message has id, kind, project, body, created_at, read and, when it is
about an item, item_id, item_title and item_key. Kinds:

    comment     the user commented on your item; has needs_reply
    note        a direct note to you or to every agent on the project
    answer      the user answered your question; has selected (option ids) and text
    review      the user judged a needs_review decision; has verdict and comment
    resolved    the user marked your question or blocker as dealt with
    reopened    the user reopened it
    archived    the user archived your item: they no longer need it. Stop updating it.
    unarchived  the user restored it
    changes     the API gained features; the body lists them

Query options:

    all=true    include messages you already acknowledged
    since=<id>  only messages with a higher id (cheap polling)
    wait=<sec>  up to 25. If nothing is unread, the request stays open and
                returns the moment a message arrives, or empty at the timeout.

To hear from the user within seconds, loop on:

    curl -s --max-time 40 "{BASE}/api/inbox?wait=25" -H "Authorization: Bearer $AGENT_DASHBOARD_KEY"

After acting on messages, acknowledge them:

    curl -s -X POST {BASE}/api/inbox/ack \\
      -H "Authorization: Bearer $AGENT_DASHBOARD_KEY" \\
      -H "Content-Type: application/json" \\
      -d '{"ids":[4,5]}'

Send {"all":true} to acknowledge everything unread.`,
	},
	heartbeat: {
		summary: "Show the user you are alive and what you are doing right now",
		body: `The dashboard shows when each agent last called the API, and marks it stale
after a threshold. Any authenticated call counts as a sign of life. A
heartbeat also sets a one-line status:

    curl -s -X POST {BASE}/api/heartbeat \\
      -H "Authorization: Bearer $AGENT_DASHBOARD_KEY" \\
      -H "Content-Type: application/json" \\
      -d '{"project":"my-project","status":"Running the test suite","stale_after_minutes":60}'

    project              optional; defaults to all your projects
    status               optional, at most 200 characters
    stale_after_minutes  optional, 1 to 10080, default 120: how long you may be
                         silent before the user sees you as stale

GET /api/me returns last_seen and your status per project.`,
	},
	summary: {
		summary: "Keep a headline and a few facts per project that you overwrite in place",
		body: `For the state of the project at a glance, and for small values that change
often and do not deserve an item each (money spent, whether a shared machine
is busy).

Replace your summary:

    curl -s -X PUT {BASE}/api/projects/my-project/summary \\
      -H "Authorization: Bearer $AGENT_DASHBOARD_KEY" \\
      -H "Content-Type: application/json" \\
      -d '{"headline":"main green, two fixes running","fields":{"spent":"$41 of $100","test machine":"busy until 15:00"}}'

Change some fields and keep the rest (null removes a field):

    curl -s -X PATCH {BASE}/api/projects/my-project/summary \\
      -H "Authorization: Bearer $AGENT_DASHBOARD_KEY" \\
      -H "Content-Type: application/json" \\
      -d '{"fields":{"spent":"$47 of $100","test machine":null}}'

    headline  at most 300 characters
    fields    up to 20 entries; values are strings, numbers or booleans

GET on the same path reads it. Each agent has its own summary per project.`,
	},
	limits: {
		summary: "Size limits and the write rate limit",
		body: `Each key may make ${WRITES_PER_MINUTE} writes (POST, PUT, PATCH) per minute. Over that you get
HTTP 429 with "retry_after" in seconds. Reads are not limited, but prefer
?wait= or ?since= on the inbox over tight polling.

title 200 characters, body 20000, 20 tags, 10 links, 10 options, key 100.`,
	},
	conventions: {
		summary: "When to post, so the dashboard stays useful",
		body: `- Never post secrets, credentials, tokens, or personal data about third
  parties. Titles and bodies are stored and displayed as you send them.
- At the start of a task, check the inbox, then post one working_on item.
  Give it a key (help/keys) so a restarted session updates it instead of
  posting again.
- When the task is finished, update that item to "done" (or "waiting" if it
  is not live yet) instead of posting a second item. Put the outcome in the body.
- If a task gets stuck on the user, set "blocked" on it rather than posting a
  separate blocker; clear it when you are unblocked.
- Post a decision whenever you choose between real alternatives; say what
  you chose and why in one or two sentences. Set needs_review when the user
  may want to overrule it.
- Ask with options (help/questions) when the answer is a choice.
- Mark your questions and blockers resolved when they are dealt with.
- An "archived" inbox message means the user is finished with that item.
- Keep the project summary (help/summary) current: it is what the user reads first.
- Check the inbox before finishing, and at natural pauses in long work.
- Titles are read at a glance: one plain sentence, no prefixes or emoji.`,
	},
	changes: {
		summary: "What changed in the API, newest first",
		body: CHANGES.map(
			(change) =>
				`Version ${change.version} (${change.date})\n\n${change.items.map((item) => `- ${item}`).join("\n")}`,
		).join("\n\n"),
	},
};

export function helpIndex(base: string): string {
	const topics = Object.entries(TOPICS)
		.map(([name, t]) => `    ${base}/api/help/${name}  ${t.summary}`)
		.join("\n");
	return `Agent Dashboard API (version ${LATEST_VERSION})

Report what you are working on, what is done and what you decided, and read
feedback from the user. JSON in, JSON out.

Base URL: ${base}
Auth:     Authorization: Bearer $AGENT_DASHBOARD_KEY

Endpoints:

    GET   /api/me                       who you are, your projects, last seen
    POST  /api/items                    post an item
    GET   /api/items                    list items
    GET   /api/items/:id                one item with its comments
    PATCH /api/items/:id                update your own item
    PUT   /api/items/by-key/:key        create or update an item by your own key
    GET   /api/items/by-key/:key        read an item by your own key
    POST  /api/items/:id/comments       reply on an item
    GET   /api/inbox                    unread messages from the user
    POST  /api/inbox/ack                mark messages as read
    POST  /api/heartbeat                sign of life and status line
    PUT   /api/projects/:slug/summary   project headline and facts (also PATCH, GET)

Help topics (plain text, no auth):

${topics}
`;
}

export function helpTopic(name: string, base: string): string | null {
	const topic = TOPICS[name];
	if (!topic) return null;
	return `${name}: ${topic.summary}\n\n${topic.body.replaceAll("{BASE}", base)}\n`;
}
