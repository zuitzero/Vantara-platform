export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthSession {
  userId: string;
  expiresAt: Date;
}
