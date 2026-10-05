-- Lets the dashboard's change check read MAX(updated_at) from one index row
-- instead of scanning the table every poll.
CREATE INDEX items_updated ON items (updated_at);
