export interface AuthUser {
  id: string;
  email: string;
  display_name: string | null;
  github_login?: string | null;
  avatar_url?: string | null;
  is_active?: boolean;
  is_verified?: boolean;
  role?: string;
}
