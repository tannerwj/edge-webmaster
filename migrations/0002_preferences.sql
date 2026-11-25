CREATE TABLE IF NOT EXISTS user_preferences (
  identity_key TEXT PRIMARY KEY,
  theme TEXT NOT NULL DEFAULT 'system',
  updated_at INTEGER NOT NULL
);
