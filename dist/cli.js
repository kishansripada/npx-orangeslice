#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const DOCS_DIR = path.join(__dirname, "..", "docs");
const TARGET_DIR = path.join(process.cwd(), "orangeslice-docs");
const AGENTS_MD = path.join(DOCS_DIR, "AGENTS.md");
const ROOT_AGENTS_MD = path.join(process.cwd(), "AGENTS.md");
/**
 * Recursively copy a directory
 */
function copyDirSync(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirSync(srcPath, destPath);
        }
        else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}
async function main() {
    console.log("\n🍊 orangeslice - B2B LinkedIn Database Prospector\n");
    console.log("   Your AI agent's sole job: understand this database and answer queries.\n");
    // 1. Copy AGENTS.md to project root (for auto-detection by Claude Code, etc.)
    console.log("1. Installing AGENTS.md at project root...");
    if (fs.existsSync(AGENTS_MD)) {
        fs.copyFileSync(AGENTS_MD, ROOT_AGENTS_MD);
        console.log("   ✓ AGENTS.md → ./AGENTS.md (auto-detected by AI agents)\n");
    }
    // 2. Copy full docs to orangeslice-docs/ (wipe existing to ensure clean state)
    console.log("2. Copying database documentation...");
    if (fs.existsSync(TARGET_DIR)) {
        fs.rmSync(TARGET_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TARGET_DIR, { recursive: true });
    const entries = fs.readdirSync(DOCS_DIR, { withFileTypes: true });
    for (const entry of entries) {
        const src = path.join(DOCS_DIR, entry.name);
        const dest = path.join(TARGET_DIR, entry.name);
        if (entry.isDirectory()) {
            copyDirSync(src, dest);
        }
        else {
            fs.copyFileSync(src, dest);
        }
    }
    console.log(`   ✓ Docs → ./orangeslice-docs/\n`);
    console.log("   Documentation:");
    console.log("   • AGENTS.md              - Agent instructions");
    console.log("   • linkedin_data/         - Full database schema + query examples");
    console.log("     ├── QUICK_REF.md       - START HERE: Critical rules & patterns");
    console.log("     ├── tables/            - Table schemas (denormalized + normalized)");
    console.log("     └── search_examples/   - Query patterns for people & companies\n");
    // 3. Install package
    console.log("3. Installing orangeslice package...");
    try {
        (0, child_process_1.execSync)("npm install orangeslice", { stdio: "inherit", cwd: process.cwd() });
    }
    catch {
        console.log("   (skipped - no package.json or npm not available)\n");
    }
    // 4. Done
    console.log("\n✅ Done! Your AI agent is now a B2B LinkedIn database prospector.\n");
    console.log("   Database: 1.15B profiles, 85M companies\n");
    console.log("   ⚠️  CRITICAL RULE: ALWAYS PARALLELIZE QUERIES\n");
    console.log("   // ❌ WRONG - Sequential");
    console.log("   const a = await orangeslice.b2b.sql('...');");
    console.log("   const b = await orangeslice.b2b.sql('...');\n");
    console.log("   // ✅ CORRECT - Parallel");
    console.log("   const [a, b] = await Promise.all([");
    console.log("     orangeslice.b2b.sql('...'),");
    console.log("     orangeslice.b2b.sql('...'),");
    console.log("   ]);\n");
    console.log("   The API handles rate limiting. Fire all queries at once.\n");
    console.log("   Read linkedin_data/QUICK_REF.md before writing queries.\n");
}
main().catch(console.error);
