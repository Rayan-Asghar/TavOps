import type { GlobalRole } from "@/lib/rbac";

declare module "next-auth" {
  interface User {
    globalRole?: GlobalRole;
    accessExpiresAt?: string | null;
    /** `users.session_version` at sign-in; compared on every request. */
    sessionVersion?: number;
  }
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      globalRole: GlobalRole;
      accessExpiresAt: string | null;
      sessionVersion: number;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    globalRole?: GlobalRole;
    accessExpiresAt?: string | null;
    sessionVersion?: number;
  }
}

export {};
