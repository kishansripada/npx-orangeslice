/**
 * Configure the AI client
 */
export declare function configure(options: {
    proxyUrl?: string;
    concurrency?: number;
    minDelayMs?: number;
}): void;
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
export declare function generateObject<T = unknown>(options: GenerateObjectOptions): Promise<T>;
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
export declare function extract<T = unknown>(text: string, schema: JsonSchema, instructions?: string): Promise<T>;
export declare const ai: {
    generateObject: typeof generateObject;
    extract: typeof extract;
    configure: typeof configure;
};
