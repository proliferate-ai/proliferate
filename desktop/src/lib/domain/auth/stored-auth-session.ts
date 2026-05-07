export interface StoredAuthSession {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  user_id: string;
  email: string;
  display_name: string | null;
  github_login?: string | null;
  avatar_url?: string | null;
}
