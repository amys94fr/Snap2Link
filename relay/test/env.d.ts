import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      IMAGES: R2Bucket;
      PUBLIC_URL: string;
      ABUSE_CONTACT: string;
      IP_SALT: string;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
