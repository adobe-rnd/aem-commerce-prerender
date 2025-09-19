/* Centralized runtime config resolver for AppBuilder actions (CommonJS) */
const { isValidUrl } = require('../utils');
const { validateAemAdminToken, validateConfigTokenWithApi } = require('./tokenValidator');

const DEFAULTS = {
    LOG_LEVEL: 'error',
    CONFIG_NAME: 'configs',
    CONFIG_SHEET: undefined,
    PRODUCT_PAGE_URL_FORMAT: undefined,
    // Only this token is supported
    AEM_ADMIN_API_AUTH_TOKEN: undefined,
    // Static default
    LOG_INGESTOR_ENDPOINT: 'https://log-ingestor.aem-storefront.com/api/v1/services/change-detector',
    // Templates (expanded using ORG/SITE when explicit values are missing)
    CONTENT_URL_TEMPLATE: 'https://main--${site}--${org}.aem.live',
    STORE_URL_TEMPLATE:   'https://main--${site}--${org}.aem.live',
    PRODUCTS_TEMPLATE_TEMPLATE: 'https://main--${site}--${org}.aem.live/products/default',
    // Raw overrides (take precedence over templates)
    CONTENT_URL: undefined,
    STORE_URL: undefined,
    PRODUCTS_TEMPLATE: undefined,

    LOCALES: undefined
};

/**
 * Build a normalized runtime config with defaults, templates and minimal validation.
 * Rules:
 *  - Require either explicit CONTENT_URL or both ORG & SITE (to derive URLs).
 *  - Admin token is not enforced here; enforce it in actions that need it.
 * @param {Object} params - Configuration parameters
 * @param {{validateToken: boolean}} options - Options for validation
 * @param {boolean} options.validateToken - Whether to validate the admin token
 * @param {boolean} options.validateTokenWithApi - Whether to validate token against AEM API (makes function async)
 * @param {Object} options.logger - Logger instance for validation errors
 * @returns {Object|Promise<Object>} Configuration object, or Promise if API validation is requested
 */
function getRuntimeConfig(params = {}, options = {}) {
    const env = process.env || {};
    const merged = sanitizeStrings({
        ...DEFAULTS,
        ...pickEnv(env, Object.keys(DEFAULTS)),
        ...params
    });

    const ORG  = merged.ORG;
    const SITE = merged.SITE;

    // Minimal presence: CONTENT_URL or (ORG & SITE)
    if (!merged.CONTENT_URL && (!ORG || !SITE)) {
        const err = new Error('Missing runtime variables: provide CONTENT_URL or both ORG and SITE');
        err.statusCode = 400;
        throw err;
    }

    const adminToken = merged.AEM_ADMIN_API_AUTH_TOKEN;

    // Validate admin token if requested
    if (options.validateToken) {
        try {
            validateAemAdminToken(adminToken, options.logger);
        } catch (error) {
            // Re-throw with additional context
            error.message = `Runtime config validation failed: ${error.message}`;
            throw error;
        }
    }

    // Expand CONTENT_URL / STORE_URL / PRODUCTS_TEMPLATE
    if (!merged.CONTENT_URL && ORG && SITE) {
        merged.CONTENT_URL = expand(merged.CONTENT_URL_TEMPLATE, { org: ORG, site: SITE });
    }
    if (!merged.STORE_URL) {
        merged.STORE_URL = merged.CONTENT_URL
            ? merged.CONTENT_URL
            : (ORG && SITE ? expand(merged.STORE_URL_TEMPLATE, { org: ORG, site: SITE }) : undefined);
    }
    if (!merged.PRODUCTS_TEMPLATE) {
        merged.PRODUCTS_TEMPLATE = merged.CONTENT_URL
            ? joinUrl(merged.CONTENT_URL, 'products/default')
            : (ORG && SITE ? expand(merged.PRODUCTS_TEMPLATE_TEMPLATE, { org: ORG, site: SITE }) : undefined);
    }

    // Normalize LOCALES
    let localesArr = [null];
    if (Array.isArray(merged.LOCALES)) {
        localesArr = merged.LOCALES.map(String).map(s => s.trim()).filter(Boolean);
        if (!localesArr.length) localesArr = [null];
    } else if (typeof merged.LOCALES === 'string' && merged.LOCALES.trim()) {
        localesArr = merged.LOCALES.split(',').map(s => s.trim()).filter(Boolean);
        if (!localesArr.length) localesArr = [null];
    }

    const cfg = {
        raw: { ...merged, LOCALES_ARRAY: localesArr },
        org: ORG,
        site: SITE,
        logLevel: merged.LOG_LEVEL,
        logIngestorEndpoint: merged.LOG_INGESTOR_ENDPOINT,
        adminAuthToken: adminToken,
        contentUrl: merged.CONTENT_URL,
        storeUrl: merged.STORE_URL,
        productsTemplate: merged.PRODUCTS_TEMPLATE,
        configName: merged.CONFIG_NAME,
        configSheet: merged.CONFIG_SHEET,
        pathFormat: merged.PRODUCT_PAGE_URL_FORMAT,
        locales: localesArr
    };

    // URL sanity checks
    validateUrls(cfg);

    // API token validation if requested (makes function async)
    if (options.validateTokenWithApi && options.logger) {
        return (async () => {
            try {
                await validateConfigTokenWithApi(cfg, options.logger);
                return cfg;
            } catch (error) {
                // Re-throw with additional context
                error.message = `Runtime config API validation failed: ${error.message}`;
                throw error;
            }
        })();
    }

    return cfg;
}

/** ${var} expander */
function expand(template, vars) {
    if (!template) return template;
    return template.replace(/\$\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
}

/** Trim string values from env/params */
function sanitizeStrings(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = typeof v === 'string' ? v.trim() : v;
    return out;
}

/** Join base URL and a tail without double slashes */
function joinUrl(base, tail) {
    if (!base) return tail;
    const b = base.replace(/\/+$/, '');
    const t = String(tail || '').replace(/^\/+/, '');
    return `${b}/${t}`;
}

function pickEnv(env, keys) {
    const out = {};
    for (const k of keys) if (env[k] !== undefined) out[k] = env[k];
    return out;
}

/** Validate URLs present in cfg */
function validateUrls(cfg) {
    if (cfg.contentUrl && !isValidUrl(cfg.contentUrl)) {
        const e = new Error('Invalid contentUrl'); e.statusCode = 400; throw e;
    }
    if (cfg.storeUrl && !isValidUrl(cfg.storeUrl)) {
        const e = new Error('Invalid storeUrl'); e.statusCode = 400; throw e;
    }
    if (cfg.productsTemplate) {
        // allow *.plain.html or *.html to be fetched later; validate the base
        const base = String(cfg.productsTemplate)
            .replace(/\.plain\.html$/i, '')
            .replace(/\.html$/i, '');
        if (!isValidUrl(base)) {
            const e = new Error('Invalid productsTemplate'); e.statusCode = 400; throw e;
        }
    }
}

module.exports = { getRuntimeConfig, DEFAULTS };
