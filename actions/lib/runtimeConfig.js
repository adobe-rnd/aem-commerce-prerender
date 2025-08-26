/* Centralized runtime config resolver for AppBuilder actions (CommonJS) */
/* eslint-disable no-console */

const DEFAULTS = {
    LOG_LEVEL: 'error',
    CONFIG_NAME: 'configs',
    CONFIG_SHEET: undefined,
    PRODUCT_PAGE_URL_FORMAT: undefined,
    AEM_ADMIN_AUTH_TOKEN: undefined,

    // Static default
    LOG_INGESTOR_ENDPOINT: 'https://log-ingestor.aem-storefront.com/api/v1/services/change-detector',

    // Templates (will be expanded using ORG/SITE)
    CONTENT_URL_TEMPLATE: 'https://main--${site}--${org}.aem.live',
    STORE_URL_TEMPLATE: 'https://main--${site}--${org}.aem.live',
    PRODUCTS_TEMPLATE_TEMPLATE: 'https://main--${site}--${org}.aem.live/products/default',

    // Raw values (may override templates)
    CONTENT_URL: undefined,
    STORE_URL: undefined,
    PRODUCTS_TEMPLATE: undefined,

    LOCALES: undefined
};

/**
 * Resolve runtime configuration by merging defaults, environment variables, and params.
 *
 * Resolution order:
 *  - DEFAULTS
 *  - process.env
 *  - params (from App Builder / invocation)
 *
 * Templates:
 *  - CONTENT_URL_TEMPLATE / STORE_URL_TEMPLATE / PRODUCTS_TEMPLATE_TEMPLATE
 *    will be expanded if explicit values are not provided.
 */
function getRuntimeConfig(params = {}) {
    const env = process.env || {};
    const merged = {
        ...DEFAULTS,
        ...pickEnv(env, Object.keys(DEFAULTS)),
        ...params
    };

    const { ORG, SITE } = merged;

    // Resolve CONTENT_URL
    if (!merged.CONTENT_URL && ORG && SITE) {
        merged.CONTENT_URL = merged.CONTENT_URL_TEMPLATE
            .replace('${org}', ORG)
            .replace('${site}', SITE);
    }

    // Resolve STORE_URL
    if (!merged.STORE_URL && ORG && SITE) {
        merged.STORE_URL = merged.STORE_URL_TEMPLATE
            .replace('${org}', ORG)
            .replace('${site}', SITE);
    }

    // Resolve PRODUCTS_TEMPLATE
    if (!merged.PRODUCTS_TEMPLATE && ORG && SITE) {
        merged.PRODUCTS_TEMPLATE = merged.PRODUCTS_TEMPLATE_TEMPLATE
            .replace('${org}', ORG)
            .replace('${site}', SITE);
    }

    // Normalize LOCALES to array
    const localesArr =
        merged.LOCALES && typeof merged.LOCALES === 'string'
            ? merged.LOCALES.split(',').map((s) => s.trim()).filter(Boolean)
            : [null];

    return {
        raw: { ...merged, LOCALES_ARRAY: localesArr },

        org: merged.ORG,
        site: merged.SITE,

        logLevel: merged.LOG_LEVEL,
        ingestorEndpoint: merged.LOG_INGESTOR_ENDPOINT,
        adminAuthToken: merged.AEM_ADMIN_AUTH_TOKEN,

        contentUrl: merged.CONTENT_URL,
        storeUrl: merged.STORE_URL,
        productsTemplate: merged.PRODUCTS_TEMPLATE,

        configName: merged.CONFIG_NAME,
        configSheet: merged.CONFIG_SHEET,
        pathFormat: merged.PRODUCT_PAGE_URL_FORMAT,

        locales: localesArr
    };
}

function pickEnv(env, keys) {
    const out = {};
    for (const k of keys) {
        if (env[k] !== undefined) out[k] = env[k];
    }
    return out;
}

module.exports = { getRuntimeConfig, DEFAULTS };
