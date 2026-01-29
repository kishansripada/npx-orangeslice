import { createQueue, createRateLimiter } from "./queue";

// Default config
let config = {
   proxyUrl: process.env.ORANGESLICE_AI_URL || "https://orangeslice.ai/api/function?functionId=generateObject",
   concurrency: 10,
   minDelayMs: 10, // 10ms between requests = max 100/sec
};

// Create queue and rate limiter with defaults
let queue = createQueue(config.concurrency);
let rateLimiter = createRateLimiter(config.minDelayMs);

/**
 * Configure the AI client
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

export interface JsonSchema {
   type: "object" | "array" | "string" | "number" | "boolean";
   properties?: Record<string, JsonSchema>;
   items?: JsonSchema;
   required?: string[];
   description?: string;
   enum?: (string | number)[];
}

export interface GenerateObjectOptions {
   prompt: string;
   schema: JsonSchema;
   system?: string;
}

interface ApiResponse {
   result?: unknown;
   error?: string;
}

/**
 * Generate a structured object from a prompt using AI.
 * Automatically rate-limited and concurrency-controlled.
 *
 * @example
 * const result = await ai.generateObject({
 *   prompt: "Extract company info: Apple Inc was founded in 1976 by Steve Jobs",
 *   schema: {
 *     type: "object",
 *     properties: {
 *       company: { type: "string" },
 *       year: { type: "number" },
 *       founder: { type: "string" }
 *     },
 *     required: ["company", "year"]
 *   }
 * });
 * // { company: "Apple Inc", year: 1976, founder: "Steve Jobs" }
 */
export async function generateObject<T = unknown>(options: GenerateObjectOptions): Promise<T> {
   return queue(async () => {
      return rateLimiter(async () => {
         // Use Buffer to ensure correct Content-Length with unicode characters
         const body = Buffer.from(JSON.stringify(options), "utf-8");
         const response = await fetch(config.proxyUrl, {
            method: "POST",
            headers: {
               "Content-Type": "application/json",
               "Content-Length": body.length.toString(),
            },
            body,
         });

         if (!response.ok) {
            throw new Error(`AI generateObject request failed: ${response.status} ${response.statusText}`);
         }

         const data = (await response.json()) as ApiResponse;

         if (data.error) {
            throw new Error(`AI generateObject error: ${data.error}`);
         }

         return data.result as T;
      });
   });
}

/**
 * Convenience method to extract structured data from text.
 *
 * @example
 * const data = await ai.extract(
 *   "Apple Inc was founded in 1976 by Steve Jobs in Cupertino",
 *   { type: "object", properties: { company: { type: "string" }, year: { type: "number" } } },
 *   "Extract the company name and founding year"
 * );
 */
export async function extract<T = unknown>(text: string, schema: JsonSchema, instructions?: string): Promise<T> {
   const prompt = instructions ? `${instructions}\n\nText:\n${text}` : `Extract structured data from the following text:\n\n${text}`;

   return generateObject<T>({ prompt, schema });
}

// Export as namespace
export const ai = {
   generateObject,
   extract,
   configure,
};
