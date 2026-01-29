/**
 * Simple concurrency queue - limits how many async operations run at once.
 * Any excess calls are queued and run when a slot opens.
 */
export function createQueue(concurrency: number) {
   let active = 0;
   const pending: Array<() => void> = [];

   const next = () => {
      if (active < concurrency && pending.length > 0) {
         active++;
         const resolve = pending.shift()!;
         resolve();
      }
   };

   return async <T>(fn: () => Promise<T>): Promise<T> => {
      // Wait for a slot to open
      await new Promise<void>((resolve) => {
         pending.push(resolve);
         next();
      });

      try {
         return await fn();
      } finally {
         active--;
         next();
      }
   };
}

/**
 * Rate limiter - ensures minimum delay between requests
 */
export function createRateLimiter(minDelayMs: number) {
   let lastRequest = 0;

   return async <T>(fn: () => Promise<T>): Promise<T> => {
      const now = Date.now();
      const timeSinceLastRequest = now - lastRequest;

      if (timeSinceLastRequest < minDelayMs) {
         await new Promise((resolve) => setTimeout(resolve, minDelayMs - timeSinceLastRequest));
      }

      lastRequest = Date.now();
      return fn();
   };
}
