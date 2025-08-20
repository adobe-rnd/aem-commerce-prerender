const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const envPath = path.resolve(process.cwd(), ".env");
const defaults = {
    PRODUCT_PAGE_URL_FORMAT: "/products/{urlKey}/{sku}"
};

// Load current .env if it exists
let envVars = {};
if (fs.existsSync(envPath)) {
    const parsed = dotenv.parse(fs.readFileSync(envPath));
    envVars = { ...parsed };
}

// Ensure SITE and ORG exist
if (!envVars.SITE || !envVars.ORG) {
    console.error("[check-env] ERROR: SITE and ORG must be defined in .env before deploy.");
    process.exit(1);
}

const site = envVars.SITE;
const org = envVars.ORG;

// Build defaults dynamically
const dynamicDefaults = {
    CONTENT_URL: `https://main--${site}--${org}.aem.live`,
    STORE_URL: `https://main--${site}--${org}.aem.live`,
    PRODUCTS_TEMPLATE: `https://main--${site}--${org}.aem.live/products/default`
};

const allDefaults = { ...defaults, ...dynamicDefaults };

// Check and set missing values
let updated = false;
for (const [key, defValue] of Object.entries(allDefaults)) {
    if (!envVars[key]) {
        envVars[key] = defValue;
        updated = true;
        console.log(`[check-env] Added variable ${key}=${defValue}`);
    }
}

// Write back if updated
if (updated) {
    const newContent = Object.entries(envVars)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");
    fs.writeFileSync(envPath, newContent);
    console.log("[check-env] .env file updated");
} else {
    console.log("[check-env] All required variables already exist, no changes needed.");
}
