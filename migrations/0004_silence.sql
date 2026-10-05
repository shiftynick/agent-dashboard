-- The owner can silence an item that needs them: it stays under "Needs you"
-- but no longer counts towards the tab title or the icon's red dot.
ALTER TABLE items ADD COLUMN silenced_at TEXT;
CREATE INDEX items_silenced ON items (silenced_at) WHERE silenced_at IS NOT NULL;
