CREATE TABLE projects (
	id INTEGER PRIMARY KEY,
	slug TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL,
	created_at TEXT NOT NULL
);

CREATE TABLE api_keys (
	id INTEGER PRIMARY KEY,
	agent TEXT NOT NULL,
	key_hash TEXT NOT NULL UNIQUE,
	key_prefix TEXT NOT NULL,
	created_at TEXT NOT NULL,
	last_used_at TEXT,
	revoked_at TEXT
);

CREATE TABLE key_projects (
	key_id INTEGER NOT NULL REFERENCES api_keys(id),
	project_id INTEGER NOT NULL REFERENCES projects(id),
	PRIMARY KEY (key_id, project_id)
);

CREATE TABLE items (
	id INTEGER PRIMARY KEY,
	project_id INTEGER NOT NULL REFERENCES projects(id),
	key_id INTEGER NOT NULL REFERENCES api_keys(id),
	agent TEXT NOT NULL,
	type TEXT NOT NULL,
	title TEXT NOT NULL,
	body TEXT NOT NULL DEFAULT '',
	tags TEXT NOT NULL DEFAULT '[]',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	archived_at TEXT
);
CREATE INDEX items_project ON items (project_id, archived_at, updated_at);

CREATE TABLE comments (
	id INTEGER PRIMARY KEY,
	item_id INTEGER NOT NULL REFERENCES items(id),
	author_kind TEXT NOT NULL,
	author TEXT NOT NULL,
	body TEXT NOT NULL,
	created_at TEXT NOT NULL
);
CREATE INDEX comments_item ON comments (item_id, created_at);

-- Things the user said that agents should read: a comment on an item, or a
-- direct note. key_id NULL means every agent with access to the project.
CREATE TABLE messages (
	id INTEGER PRIMARY KEY,
	project_id INTEGER NOT NULL REFERENCES projects(id),
	key_id INTEGER REFERENCES api_keys(id),
	item_id INTEGER REFERENCES items(id),
	kind TEXT NOT NULL,
	body TEXT NOT NULL,
	created_at TEXT NOT NULL
);
CREATE INDEX messages_project ON messages (project_id, created_at);

CREATE TABLE message_acks (
	message_id INTEGER NOT NULL REFERENCES messages(id),
	key_id INTEGER NOT NULL REFERENCES api_keys(id),
	acked_at TEXT NOT NULL,
	PRIMARY KEY (message_id, key_id)
);
