import { createQueue, createRateLimiter } from "./queue";

// Default config
let config = {
   proxyUrl: process.env.ORANGESLICE_API_URL || "https://orangeslice.ai/api/function?functionId=b2b",
   concurrency: 2,
   minDelayMs: 100, // 100ms between requests = max 10/sec
};

// Create queue and rate limiter with defaults
let queue = createQueue(config.concurrency);
let rateLimiter = createRateLimiter(config.minDelayMs);

/**
 * Helper to make POST request, handling redirects manually
 * (Node.js fetch has issues with POST body on redirects)
 * Uses Buffer to ensure correct Content-Length with unicode characters
 */
async function fetchWithRedirect(url: string, bodyStr: string): Promise<Response> {
   const body = Buffer.from(bodyStr, "utf-8");
   let response = await fetch(url, {
      method: "POST",
      headers: {
         "Content-Type": "application/json",
         "Content-Length": body.length.toString(),
      },
      body,
      redirect: "manual",
   });

   // Handle redirect manually - re-POST to the new location
   if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location) {
         response = await fetch(location, {
            method: "POST",
            headers: {
               "Content-Type": "application/json",
               "Content-Length": body.length.toString(),
            },
            body,
         });
      }
   }

   return response;
}

/**
 * Configure the B2B client
 */
export function configure(options: { proxyUrl?: string; concurrency?: number; minDelayMs?: number }) {
   if (options.proxyUrl) config.proxyUrl = options.proxyUrl;
   if (options.concurrency) {
      config.concurrency = options.concurrency;
      queue = createQueue(options.concurrency);
   }
   if (options.minDelayMs !== undefined) {
      config.minDelayMs = options.minDelayMs;
      rateLimiter = createRateLimiter(options.minDelayMs);
   }
}

export interface QueryResult<T = Record<string, unknown>> {
   rows: T[];
   rowCount: number;
   duration_ms: number;
}

interface ApiResponse {
   rows?: unknown[];
   rowCount?: number;
   duration_ms?: number;
   error?: string;
}

/**
 * Execute a SQL query against the B2B database.
 * Automatically rate-limited and concurrency-controlled.
 *
 * @example
 * const companies = await b2b.sql<Company[]>("SELECT * FROM linkedin_company WHERE domain = 'stripe.com'");
 */
export async function sql<T = Record<string, unknown>[]>(sqlQuery: string): Promise<T> {
   return queue(async () => {
      return rateLimiter(async () => {
         const body = JSON.stringify({ sql: sqlQuery });
         const response = await fetchWithRedirect(config.proxyUrl, body);

         if (!response.ok) {
            throw new Error(`B2B SQL request failed: ${response.status} ${response.statusText}`);
         }

         const data = (await response.json()) as ApiResponse;

         if (data.error) {
            throw new Error(`B2B SQL error: ${data.error}`);
         }

         return (data.rows || []) as T;
      });
   });
}

/**
 * Execute a SQL query and get full result with metadata
 */
export async function query<T = Record<string, unknown>>(sqlQuery: string): Promise<QueryResult<T>> {
   return queue(async () => {
      return rateLimiter(async () => {
         const body = JSON.stringify({ sql: sqlQuery });
         const response = await fetchWithRedirect(config.proxyUrl, body);

         if (!response.ok) {
            throw new Error(`B2B SQL request failed: ${response.status} ${response.statusText}`);
         }

         const data = (await response.json()) as ApiResponse;

         if (data.error) {
            throw new Error(`B2B SQL error: ${data.error}`);
         }

         return {
            rows: (data.rows || []) as T[],
            rowCount: data.rowCount || 0,
            duration_ms: data.duration_ms || 0,
         };
      });
   });
}

// Export as namespace
export const b2b = {
   sql,
   query,
   configure,
};
