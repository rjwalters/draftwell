-- Voice profiles and writing samples for personalized style review
-- Voice profiles store AI-generated style rules across 11 dimensions
-- Writing samples are stored inline (small) or referenced via R2 (large)

-- Voice profiles table
CREATE TABLE IF NOT EXISTS voice_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Default',
  profile_data TEXT NOT NULL, -- JSON: structured rules across 11 voice dimensions
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Voice samples table (writing samples used to generate profiles)
CREATE TABLE IF NOT EXISTS voice_samples (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  voice_profile_id TEXT, -- NULL until profile is generated
  sample_text TEXT, -- inline for small samples
  r2_key TEXT, -- R2 reference for large samples
  source_url TEXT, -- optional URL where sample originated
  word_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (voice_profile_id) REFERENCES voice_profiles(id) ON DELETE SET NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_voice_profiles_user_id ON voice_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_voice_samples_user_id ON voice_samples(user_id);
CREATE INDEX IF NOT EXISTS idx_voice_samples_profile_id ON voice_samples(voice_profile_id);
