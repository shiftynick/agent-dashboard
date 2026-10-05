ALTER TABLE items ADD COLUMN key TEXT;
ALTER TABLE items ADD COLUMN author TEXT;
ALTER TABLE items ADD COLUMN blocked TEXT;
ALTER TABLE items ADD COLUMN resolved_at TEXT;
ALTER TABLE items ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN links TEXT NOT NULL DEFAULT '[]';
-- JSON {options, multi, allow_other} for questions the owner answers in the UI.
ALTER TABLE items ADD COLUMN question TEXT;
-- JSON {selected, labels, text, answered_at}.
ALTER TABLE items ADD COLUMN answer TEXT;
ALTER TABLE items ADD COLUMN made_by TEXT;
ALTER TABLE items ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0;
-- JSON {verdict, comment, at}.
ALTER TABLE items ADD COLUMN review TEXT;
-- When the owner last had the item on screen.
ALTER TABLE items ADD COLUMN seen_at TEXT;
CREATE UNIQUE INDEX items_key ON items (key_id, project_id, key) WHERE key IS NOT NULL;

CREATE TABLE item_history (
	id INTEGER PRIMARY KEY,
	item_id INTEGER NOT NULL REFERENCES items(id),
	type TEXT NOT NULL,
	title TEXT NOT NULL,
	body TEXT NOT NULL,
	changed_at TEXT NOT NULL
);
CREATE INDEX item_history_item ON item_history (item_id, changed_at);

ALTER TABLE comments ADD COLUMN needs_reply INTEGER NOT NULL DEFAULT 0;

-- JSON with kind-specific fields, merged into the inbox message.
ALTER TABLE messages ADD COLUMN data TEXT;

-- Highest changelog version already delivered to this key's inbox.
ALTER TABLE api_keys ADD COLUMN seen_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE projects ADD COLUMN work_stale_hours INTEGER NOT NULL DEFAULT 24;

CREATE TABLE agent_status (
	key_id INTEGER NOT NULL REFERENCES api_keys(id),
	project_id INTEGER NOT NULL REFERENCES projects(id),
	status TEXT NOT NULL DEFAULT '',
	stale_after_minutes INTEGER NOT NULL DEFAULT 120,
	status_at TEXT NOT NULL,
	PRIMARY KEY (key_id, project_id)
);

CREATE TABLE summaries (
	key_id INTEGER NOT NULL REFERENCES api_keys(id),
	project_id INTEGER NOT NULL REFERENCES projects(id),
	headline TEXT NOT NULL DEFAULT '',
	fields TEXT NOT NULL DEFAULT '{}',
	updated_at TEXT NOT NULL,
	PRIMARY KEY (key_id, project_id)
);

CREATE TABLE rate_limits (
	key_id INTEGER NOT NULL REFERENCES api_keys(id),
	minute INTEGER NOT NULL,
	count INTEGER NOT NULL,
	PRIMARY KEY (key_id, minute)
);
