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
export const orangeslice = {
   b2b,
   ai,
};

export default orangeslice;
