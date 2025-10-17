# AEM Commerce Prerender

Pluggable prerendering stack for ahead-of-time data fetching and embedding in Product Pages and framework for defining rendering templates and rules.

* ⚡️ Boost SEO by pre-rendering human-readable product data in the markup
* 💉 Inject JSON-LD Structured data in the page source code
* 📈 Aggregate data sources and inject resulting data ahead-of-time
* ⚙️ Define your custom rendering logic
* 🧠 Offload intensive computation to the rendering phase

## Principle of Operation & Architecture

![Principle of Operation](/docs/principle-of-operation.jpg)

<details>
  <summary>Expand the diagram</summary>

  ![Architecture](/docs/architecture-overview.jpg)

</details>

## Getting started

  Setup of prerequisites and Edge Delivery Services is guided and some steps are automated.

### Configuration Wizard

  1. In case you do not have an App Builder environment JSON file, follow the [App Builder Setup Guide](#app-builder-setup)
  1. [Create a repo](https://github.com/new?template_name=aem-commerce-prerender&template_owner=adobe-rnd) from template in your org. Clone the new repo to your local machine
  1. Download your AppBuilder project JSON file, you will use it to perform the initial setup wizard that will show up in the browser
  1. Run `npm run setup` to onboard and configure your environment. The wizard will automatically populate configuration values from your site and create a `.env` file with the necessary environment variables.
  1. **Step 3 - Advanced Settings**: The wizard will populate default values for most configuration fields based on your organization and site information. If you need to customize these settings, expand the advanced settings section:
     * **Template URL**: By default, the wizard auto-populates the template URL based on your site name and organization. If your site has localized templates with URLs like `https://main--site--org.aem.page/en-us/products/default`, you can use the `{locale}` token to create a URL pattern: `https://main--site--org.aem.page/{locale}/products/default`. This token will be dynamically replaced with the actual locale values during rendering.
     * **Product Page URL Format** (`pathPrefix`): This defines the path pattern under which product pages will be served. You can use the following tokens: `{locale}`, `{urlKey}`, `{sku}`. The default pattern is typically `/{locale}/products/{urlKey}`. If deploying to a live environment and you need logical separation from existing pages, consider using a different path prefix such as `/{locale}/products-prerendered/{urlKey}`. When ready to switch traffic, update the path format in `app.config.yaml` and run `aio app deploy` again.
     * **Locales**: If your site is localized, specify the locales (e.g., `en-us,en-gb,fr-fr`). Leave empty if your site is not localized.
  1. **Environment Variables**: After completing the setup wizard, all configuration values (except `LOG_LEVEL`, `LOG_INGESTOR_ENDPOINT`, and `CONFIG_NAME` which are defined in `app.config.yaml`) will be stored in the `.env` file in your project root. You can modify these values by editing the `.env` file directly.
  1. At the end of the process a Site Context will be created and stored in your localStorage: this will be the authentication medium required to operate the <https://prerender.aem-storefront.com> management interface (you will be redirected to this address).
  1. [Customize the code](/docs/CUSTOMIZE.md) that contains the rendering logic according to your requirements, for [structured data](/actions/pdp-renderer/ldJson.js), [markup](/actions/pdp-renderer/render.js) and [templates](https://github.com/adobe-rnd/aem-commerce-prerender/tree/main/actions/pdp-renderer/templates)
  1. Deploy the solution with `npm run deploy`
  1. **Testing Actions Manually**: Before enabling automated triggers, verify that each action works correctly by invoking them manually:
     ```bash
     # Fetch all products from Catalog Service and store them in default-products.json
     aio rt action invoke fetch-all-products
     
     # Check for product changes and generate markup (first run processes all products)
     aio rt action invoke check-product-changes
     
     # Clean up and unpublish deleted products
     aio rt action invoke mark-up-clean-up
     ```
  1. **Enable Automated Triggers**: Once you've confirmed that all actions work correctly, uncomment the triggers and rules sections in `app.config.yaml`:
     ```yaml
     triggers:
       productPollerTrigger:
         feed: "/whisk.system/alarms/interval"
         inputs:
           minutes: 5
       productScraperTrigger:
         feed: "/whisk.system/alarms/interval"
         inputs:
           minutes: 60
       markUpCleanUpTrigger:
         feed: "/whisk.system/alarms/interval"
         inputs:
           minutes: 60
     rules:
       productPollerRule:
         trigger: "productPollerTrigger"
         action: "check-product-changes"
       productScraperRule:
         trigger: "productScraperTrigger"
         action: "fetch-all-products"
       markUpCleanUpRule:
         trigger: "markUpCleanUpTrigger"
         action: "mark-up-clean-up"
     ```
     Then redeploy the solution: `npm run deploy`
  1. Go to the [Storefront Prerender](https://prerender.aem-storefront.com/#/change-detector) and check that the rules for change detector are enabled (green circles).
  1. The system is now up and running. In the first cycle of operation, it will publish all products in the catalog. Subsequent runs will only process products that have changed. You can browse and count them from [the Management UI](https://prerender.aem-storefront.com/#/products)
  1. From within the same UI, in the "Markup Storage" tab, you can browse the generated HTML files. You can also reset the state of the Change Detector ("Reset Products List") and force republish of all the products ("Trigger Product Scraping" button).

### Configuration Variables

The solution uses two types of configuration:

1. **Static Configuration** (defined in `app.config.yaml`):
   * `LOG_LEVEL`: Controls the logging verbosity (default: "error")
   * `LOG_INGESTOR_ENDPOINT`: The endpoint for sending logs and statistics
   * `CONFIG_NAME`: The name of the configuration sheet (default: "config")

2. **Environment-Specific Configuration** (stored in `.env` file after setup):
   * `ORG`: Your GitHub organization or username
   * `SITE`: Your site/repository name
   * `PRODUCT_PAGE_URL_FORMAT`: The URL pattern for product pages (e.g., `/products/{urlKey}/{sku}`)
   * `LOCALES`: Comma-separated list of locales (e.g., `en-us,en-gb,fr-fr`) or empty for non-localized sites
   * `CONTENT_URL`: Your AEM content URL
   * `PRODUCTS_TEMPLATE`: The template URL for product pages
   * `STORE_URL`: Your Commerce store URL
   * `AEM_ADMIN_API_AUTH_TOKEN`: Long-lived authentication token for AEM Admin API (valid for 1 year). During setup, the wizard will exchange your temporary 24-hour token from [admin.hlx.page](https://admin.hlx.page/) for this long-lived token automatically.

These variables can be modified by editing the `.env` file directly or by re-running the setup wizard with `npm run setup`.

### Management UI Setup

A context is an object holding information and credentials on a deployment of the Prerender stack, to authenticate against AppBuilder and AEM Admin API.
If you have configured contexts in [the management UI](https://prerender.aem-storefront.com), you can export the one selected in the dropdown (top-right) by clicking on the 📤 button, and hand it over to your collaborators. They can import it by clicking on 📥 (next to the context selector dropdown) and use that context.

### App Builder Setup

_For the following steps, you need the "Developer" role [in the Admin Console](https://helpx.adobe.com/enterprise/using/manage-developers.html)_

  1. First install `aio` CLI globally: `npm install -g @adobe/aio-cli`.
  1. Go to [Adobe Developer Console](https://developer.adobe.com/console) and choose "Create project from template"
  1. Select "App Builder" and choose the environment (workspaces) according to your needs (we recommend Stage and Production as a starting point)
  1. You can leave all the other fields as per default settings; don't forget to provide a descriptive project title.
  1. After saving the newly created project, click on the workspace you want to deploy the prerendering stack to - use Stage to get started.
  1. In the top-right click "Download All": this will download a JSON file that will be used in the [setup process](#configuration-wizard).

### URL Naming and Sanitization

Product page URLs and pathnames must comply with AEM's [document naming limits](https://www.aem.live/docs/limits#document-naming).

**SKU Lowercase Requirement**: 

Starting with the [October 2025 Adobe Commerce Storefront release](https://experienceleague.adobe.com/developer/commerce/storefront/releases/#highlights), all SKUs in product URLs are automatically converted to lowercase to ensure URL consistency and proper product resolution.

**How it works**:
* If your `PRODUCT_PAGE_URL_FORMAT` (configured in `.env` after setup) includes the `{sku}` token, any SKU containing uppercase letters or unsupported characters will be automatically sanitized to lowercase.
* **Example**: A product with SKU `MY_PRODUCT_123` will generate the URL path `/products/my-product-123`.

**Important**: Because SKUs in URLs are transformed to lowercase, always retrieve the original product SKU from the `<meta name="sku">` tag in the page `<head>` rather than parsing it from the URL. This ensures your frontend code can query Commerce Services with the correct SKU format.

### PDP Drop-in (Frontend Integration)

* In the prerendered PDPs, the SKU - originally parsed from the URL - can be retrieved from the meta tag `meta[name="sku"]`. This way of retrieving the SKU is generally more robust and becomes a requirement when the SKU is sanitized, and therefore it is not possible to query the actual product using it, because the transformed SKU is not in Commerce Services.
* One requirement could be to hide the prerendered semantic markup (the one coming from the templates and in general, the pdp-renderer action) and the advised way to do it is to simply replace the contents of `.product-details` block with the decorated HTML hosting the PDP drop-in.
* In fact, this semantic HTML provides rich information and context to LLM crawlers as well as search engine crawlers not supporting JavaScript: having JS replace that code with the UI meant for client-side rendering, means that if no JS is available the semantic HTML operates as a natural fallback.

### What's next?

 You might want to check out the [instructions and guidelines](/docs/POST-SETUP.md) around operation and maintenance of the solution

### Troubleshooting

Please follow the [runbook](/docs/RUNBOOK.md) to troubleshoot issues during development and system ops.

## Considerations & Use Cases

Some considerations around [advantages, use cases and prerequisites](/docs/USE-CASES.md).
