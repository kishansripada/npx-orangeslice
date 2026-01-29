/**
 * Simple concurrency queue - limits how many async operations run at once.
 * Any excess calls are queued and run when a slot opens.
 */
export declare function createQueue(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T>;
/**
 * Rate limiter - ensures minimum delay between requests
 */
export declare function createRateLimiter(minDelayMs: number): <T>(fn: () => Promise<T>) => Promise<T>;
