export interface Env {
  DB: D1Database;
  CONTENT_BUCKET: R2Bucket;
  RATE_LIMIT: KVNamespace;
  AI: Ai;
  APP_NAME: string;
  ANTHROPIC_API_KEY: string;
  AI_GATEWAY: string;
  AI_GATEWAY_TOKEN: string;
}

export interface VoiceProfile {
  id: string;
  user_id: string;
  name: string;
  profile_data: string;
  created_at: string;
  updated_at: string;
}

export interface VoiceSample {
  id: string;
  user_id: string;
  voice_profile_id: string | null;
  sample_text: string | null;
  r2_key: string | null;
  source_url: string | null;
  word_count: number;
  created_at: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}

export interface Document {
  id: string;
  project_id: string;
  title: string;
  current_revision: number;
  r2_key: string;
  created_at: string;
  updated_at: string;
}
