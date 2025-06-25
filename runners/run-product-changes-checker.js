require('dotenv').config();
const { main } = require('../actions/check-product-changes/index');

(async () => {
    try {
        console.log(new Date().toISOString(), 'Starting the action');
        const resp = await main({
            libInit: {
                ow: {
                    namespace: process.env.AIO_runtime_namespace,
                    auth: process.env.AIO_runtime_auth,
                }
            },
            AEM_ADMIN_AUTH_TOKEN: process.env.AEM_ADMIN_AUTH_TOKEN,
            SITE: process.env.SITE,
            ORG: process.env.ORG,
            STORE_URL: process.env.STORE_URL,
            CONTENT_URL: process.env.CONTENT_URL,
            CONFIG_NAME: process.env.CONFIG_NAME,
            CONFIG_SHEET: process.env.CONFIG_SHEET,
            LOG_LEVEL: 'info',
            LOG_INGESTOR_ENDPOINT: process.env.LOG_INGESTOR_ENDPOINT,
            PRODUCT_PAGE_URL_FORMAT: process.env.PRODUCT_PAGE_URL_FORMAT,
            PRODUCTS_TEMPLATE: process.env.PRODUCTS_TEMPLATE,
            LOCALES: process.env.LOCALES,
        });
        console.log(JSON.stringify(resp, null, 2));
    } catch (error) {
        console.error('An error occurred:', error);
    } finally {
        console.log(new Date().toISOString(), 'Finishing the action');
    }
})();
