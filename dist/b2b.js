"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.b2b = void 0;
exports.configure = configure;
exports.sql = sql;
exports.query = query;
const queue_1 = require("./queue");
// Default config
let config = {
    proxyUrl: process.env.ORANGESLICE_API_URL || "https://orangeslice.ai/api/function?functionId=b2b",
    concurrency: 2,
    minDelayMs: 100, // 100ms between requests = max 10/sec
};
// Create queue and rate limiter with defaults
let queue = (0, queue_1.createQueue)(config.concurrency);
let rateLimiter = (0, queue_1.createRateLimiter)(config.minDelayMs);
/**
 * Helper to make POST request, handling redirects manually
 * (Node.js fetch has issues with POST body on redirects)
 * Uses Buffer to ensure correct Content-Length with unicode characters
 */
async function fetchWithRedirect(url, bodyStr) {
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
 * Execute a SQL query against the B2B database.
 * Automatically rate-limited and concurrency-controlled.
 *
 * @example
 * const companies = await b2b.sql<Company[]>("SELECT * FROM linkedin_company WHERE domain = 'stripe.com'");
 */
async function sql(sqlQuery) {
    return queue(async () => {
        return rateLimiter(async () => {
            const body = JSON.stringify({ sql: sqlQuery });
            const response = await fetchWithRedirect(config.proxyUrl, body);
            if (!response.ok) {
                throw new Error(`B2B SQL request failed: ${response.status} ${response.statusText}`);
            }
            const data = (await response.json());
            if (data.error) {
                throw new Error(`B2B SQL error: ${data.error}`);
            }
            return (data.rows || []);
        });
    });
}
/**
 * Execute a SQL query and get full result with metadata
 */
async function query(sqlQuery) {
    return queue(async () => {
        return rateLimiter(async () => {
            const body = JSON.stringify({ sql: sqlQuery });
            const response = await fetchWithRedirect(config.proxyUrl, body);
            if (!response.ok) {
                throw new Error(`B2B SQL request failed: ${response.status} ${response.statusText}`);
            }
            const data = (await response.json());
            if (data.error) {
                throw new Error(`B2B SQL error: ${data.error}`);
            }
            return {
                rows: (data.rows || []),
                rowCount: data.rowCount || 0,
                duration_ms: data.duration_ms || 0,
            };
        });
    });
}
// Export as namespace
exports.b2b = {
    sql,
    query,
    configure,
};
