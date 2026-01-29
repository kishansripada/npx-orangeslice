"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createQueue = createQueue;
exports.createRateLimiter = createRateLimiter;
/**
 * Simple concurrency queue - limits how many async operations run at once.
 * Any excess calls are queued and run when a slot opens.
 */
function createQueue(concurrency) {
    let active = 0;
    const pending = [];
    const next = () => {
        if (active < concurrency && pending.length > 0) {
            active++;
            const resolve = pending.shift();
            resolve();
        }
    };
    return async (fn) => {
        // Wait for a slot to open
        await new Promise((resolve) => {
            pending.push(resolve);
            next();
        });
        try {
            return await fn();
        }
        finally {
            active--;
            next();
        }
    };
}
/**
 * Rate limiter - ensures minimum delay between requests
 */
function createRateLimiter(minDelayMs) {
    let lastRequest = 0;
    return async (fn) => {
        const now = Date.now();
        const timeSinceLastRequest = now - lastRequest;
        if (timeSinceLastRequest < minDelayMs) {
            await new Promise((resolve) => setTimeout(resolve, minDelayMs - timeSinceLastRequest));
        }
        lastRequest = Date.now();
        return fn();
    };
}
