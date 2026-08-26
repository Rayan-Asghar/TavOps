import type { GlobalRole } from "@/lib/rbac";

declare module "next-auth" {
  interface User {
    globalRole?: GlobalRole;
    accessExpiresAt?: string | null;
  }
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      globalRole: GlobalRole;
      accessExpiresAt: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    globalRole?: GlobalRole;
    accessExpiresAt?: string | null;
  }
}

export {};
