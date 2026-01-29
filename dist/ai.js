"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ai = void 0;
exports.configure = configure;
exports.generateObject = generateObject;
exports.extract = extract;
const queue_1 = require("./queue");
// Default config
let config = {
    proxyUrl: process.env.ORANGESLICE_AI_URL || "https://orangeslice.ai/api/function?functionId=generateObject",
    concurrency: 10,
    minDelayMs: 10, // 10ms between requests = max 100/sec
};
// Create queue and rate limiter with defaults
let queue = (0, queue_1.createQueue)(config.concurrency);
let rateLimiter = (0, queue_1.createRateLimiter)(config.minDelayMs);
/**
 * Configure the AI client
 */
function configure(options) {
    if (options.proxyUrl)
        config.proxyUrl = options.proxyUrl;
    if (options.concurrency) {
        config.concurrency = options.concurrency;
        queue = (0, queue_1.createQueue)(options.concurrency);
    }
    if (options.minDelayMs !== undefined) {
        config.minDelayMs = options.minDelayMs;
        rateLimiter = (0, queue_1.createRateLimiter)(options.minDelayMs);
    }
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
async function generateObject(options) {
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
            const data = (await response.json());
            if (data.error) {
                throw new Error(`AI generateObject error: ${data.error}`);
            }
            return data.result;
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
async function extract(text, schema, instructions) {
    const prompt = instructions ? `${instructions}\n\nText:\n${text}` : `Extract structured data from the following text:\n\n${text}`;
    return generateObject({ prompt, schema });
}
// Export as namespace
exports.ai = {
    generateObject,
    extract,
    configure,
};
