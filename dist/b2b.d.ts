/**
 * Configure the B2B client
 */
export declare function configure(options: {
    proxyUrl?: string;
    concurrency?: number;
    minDelayMs?: number;
}): void;
export interface QueryResult<T = Record<string, unknown>> {
    rows: T[];
    rowCount: number;
    duration_ms: number;
}
/**
 * Execute a SQL query against the B2B database.
 * Automatically rate-limited and concurrency-controlled.
 *
 * @example
 * const companies = await b2b.sql<Company[]>("SELECT * FROM linkedin_company WHERE domain = 'stripe.com'");
 */
export declare function sql<T = Record<string, unknown>[]>(sqlQuery: string): Promise<T>;
/**
 * Execute a SQL query and get full result with metadata
 */
export declare function query<T = Record<string, unknown>>(sqlQuery: string): Promise<QueryResult<T>>;
export declare const b2b: {
    sql: typeof sql;
    query: typeof query;
    configure: typeof configure;
};
