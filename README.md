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
  1. Run `npm run setup` to onboard and configure your environment. The wizard will automatically detect and populate default values for `CONTENT_URL`, `STORE_URL`, `PRODUCTS_TEMPLATE`, and `PRODUCT_PAGE_URL_FORMAT` based on your site configuration. You can review and modify these values during the setup process. A `.env` file will be created with all necessary environment variables.
  1. **Step 3 - Advanced Settings**: The wizard will populate default values for most configuration fields based on your organization and site information. If you need to customize these settings, expand the advanced settings section:
     * **Template URL**: By default, the wizard auto-populates the template URL based on your site name and organization. If your site has localized templates with URLs like `https://main--site--org.aem.page/en-us/products/default`, you can use the `{locale}` token to create a URL pattern: `https://main--site--org.aem.page/{locale}/products/default`. This token will be dynamically replaced with the actual locale values during rendering.
     * **Product Page URL Format** (`pathPrefix`): This defines the path pattern under which product pages will be served. You can use the following tokens: `{locale}`, `{urlKey}`, `{sku}`. The default pattern is typically `/{locale}/products/{urlKey}`. If deploying to a live environment and you need logical separation from existing pages, consider using a different path prefix such as `/{locale}/products-prerendered/{urlKey}`. When ready to switch traffic, update the `PRODUCT_PAGE_URL_FORMAT` in your `.env` file and run `aio app deploy` again.
     * **Locales**: If your site is localized, specify the locales (e.g., `en-us,en-gb,fr-fr`). Leave empty if your site is not localized.
  1. **Configuration Variables**: After completing the setup wizard, the solution will use two types of configuration:
     
     **Static Configuration** (defined in `app.config.yaml`):
     * `LOG_LEVEL`: Controls the logging verbosity (default: "error")
     * `LOG_INGESTOR_ENDPOINT`: The endpoint for sending logs and statistics
     * `CONFIG_NAME`: The name of the configuration sheet (default: "config")
     
     **Environment-Specific Configuration** (stored in `.env` file):
     * `ORG`: Your GitHub organization or username
     * `SITE`: Your site/repository name
     * `PRODUCT_PAGE_URL_FORMAT`: The URL pattern for product pages (e.g., `/products/{urlKey}/{sku}`)
     * `LOCALES`: Comma-separated list of locales (e.g., `en-us,en-gb,fr-fr`) or empty for non-localized sites
     * `CONTENT_URL`: Your AEM content URL
     * `PRODUCTS_TEMPLATE`: The template URL for product pages
     * `STORE_URL`: Your Commerce store URL
     * `AEM_ADMIN_API_AUTH_TOKEN`: Long-lived authentication token for AEM Admin API (valid for 1 year). During setup, the wizard will exchange your temporary 24-hour token from [admin.hlx.page](https://admin.hlx.page/) for this long-lived token automatically.
     
     You can modify the environment-specific variables by editing the `.env` file directly or by re-running the setup wizard with `npm run setup`.
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
  1. **Management UI Overview**: Navigate to the [Storefront Prerender Management UI](https://prerender.aem-storefront.com) to monitor and manage your prerender deployment. The UI provides several tabs:
     
     * **Published Products** (`#/products`): Displays the list of products published on your store, as retrieved from your site's `published-products-index.json`. For sites with over a thousand products, use the pagination interface to navigate through results. The search functionality allows you to filter products on the current page.
     
     * **Change Detector** (`#/change-detector`): Allows you to start or stop the regularly scheduled polling and rerendering of product data. Check that the rules are enabled (green circles). This tab also displays the timestamp of the last execution.
     
     * **Renderer** (`#/renderer`): Provides detailed information about your generated markup. Enter a product path in the format `/products/{urlKey}/{sku}` to view product data. Note that SKU is case-sensitive (e.g., `/products/access-at-adobe-sticker/ADB111` or `/products/itt743/ITT743`).
     
     * **Logs and Activations** (`#/logs`): Allows you to access the prerender's logs by entering your organization and site information along with the log's activation ID.
     
     * **Markup Storage** (`#/markup-storage`): Displays the 1,000 most recently created markup files, along with product lists and state files. This tab provides several actions:
       - **Refresh**: Reloads the list of generated files
       - **Reset Products List**: Clears the App Builder storage of all files
       - **Trigger Product Scraping**: Manually queries the site's Catalog Service for product information and generates product lists for all locales. This process also runs automatically every hour.
       
       Key files in Markup Storage:
       - **Product List** (`check-product-change/{locale}-products.json`): Contains all product SKUs and URL keys for that locale/store, queried from the Catalog Service endpoint as defined in your site's `config.json`.
       - **State File** (`check-product-change/{locale}.json`): Tracks all generated markups for that locale. Each entry includes the product SKU, last rendered time (in epoch time), and a hash of the markup file. This file is updated as the prerender creates, updates, or removes markup.
     
     * **Settings** (`#/settings`): Allows you to access and modify your personal context file. The context file contains information about the prerender app's namespace, authentication token, and the currently active Helix token. Editing the context file enables you to use the prerender UI to manage other App Builder applications.
  
  1. The system is now up and running. In the first cycle of operation, it will publish all products in the catalog. Subsequent runs will only process products that have changed.

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
