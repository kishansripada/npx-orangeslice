"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.orangeslice = exports.ai = exports.b2b = void 0;
const b2b_1 = require("./b2b");
Object.defineProperty(exports, "b2b", { enumerable: true, get: function () { return b2b_1.b2b; } });
const ai_1 = require("./ai");
Object.defineProperty(exports, "ai", { enumerable: true, get: function () { return ai_1.ai; } });
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
exports.orangeslice = {
    b2b: b2b_1.b2b,
    ai: ai_1.ai,
};
exports.default = exports.orangeslice;
