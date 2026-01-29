import { b2b } from "./b2b";
import { ai } from "./ai";
export { b2b, ai };
/**
 * orangeslice - B2B LinkedIn Database + AI
 *
 * @example
 * import { orangeslice } from 'orangeslice';
 *
 * // Query 1B+ LinkedIn profiles
 * const companies = await orangeslice.b2b.sql("SELECT * FROM linkedin_company WHERE domain = 'stripe.com'");
 *
 * // Generate structured data with AI
 * const extracted = await orangeslice.ai.generateObject({
 *   prompt: "Extract company info: Apple was founded in 1976",
 *   schema: { type: "object", properties: { name: { type: "string" }, year: { type: "number" } } }
 * });
 */
export declare const orangeslice: {
    b2b: {
        sql: typeof import("./b2b").sql;
        query: typeof import("./b2b").query;
        configure: typeof import("./b2b").configure;
    };
    ai: {
        generateObject: typeof import("./ai").generateObject;
        extract: typeof import("./ai").extract;
        configure: typeof import("./ai").configure;
    };
};
export default orangeslice;
