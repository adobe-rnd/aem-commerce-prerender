# AEM Commerce Prerender

The AEM Commerce Prerenderer is a tool to generate static product detail pages from dynamic data sources like Adobe Commerce Catalog Service for publishing via [AEM Edge Delivery Services](https://www.aem.live/). It integrates with [BYOM (Bring Your Own Markup)](https://www.aem.live/docs/byo-markup) and EDS indexes to deliver fast, SEO-friendly pages.

## Key Benefits

* ⚡️ **Boost SEO** by delivering prerendered, human-readable HTML for critical page content directly to the client, ensuring that search engines and AI agents receive essential information instantly, without relying on client-side rendering
* 🤖 **AI-Ready Content** - Make content accessible for AI agents and parsers that cannot execute JavaScript, ensuring they can read both the visible page content and embedded JSON-LD data without additional processing
* 💉 **Enhanced Search Visibility** - Inject JSON-LD structured data directly into the page source code
* 📈 **Flexible Data Integration** - Aggregate, modify, and enrich data from multiple sources before rendering
* ⚙️ **Customizable Rendering** - Define your custom rendering logic and templates
* 🧠 **Performance Optimization** - Offload intensive computation to the rendering phase

## Architecture Overview

![Principle of Operation](/docs/principle-of-operation.jpg)

The Prerenderer fetches products from the Catalog Service, detects changes, and generates HTML with meta tags, markup, and JSON-LD. This HTML is stored in App Builder storage (Azure Blob Storage) and then published by merging it with the original page.

<details>
  <summary>View detailed architecture diagram</summary>

  ![Architecture](/docs/architecture-overview.jpg)

</details>

## Prerequisites

Before you begin, make sure you have:

* **Node.js** (LTS version recommended)
* **Adobe I/O App Builder CLI** (`aio`) - [Installation guide](https://developer.adobe.com/app-builder/docs/getting_started/first_app/#1-install-aio-cli)
* **Developer or System Administrator role** in your Adobe IMS organization to manage Developer Console projects and App Builder access - [See documentation](https://helpx.adobe.com/enterprise/using/manage-developers.html)
* **Access to Adobe Commerce** with Catalog Service enabled
* **AEM Edge Delivery Services site** configured

## Quick Start

1. [Create a repository](https://github.com/new?template_name=aem-commerce-prerender&template_owner=adobe-rnd) from the provided template in your organization and clone it to your local machine
2. In the cloned repository, run `npm install` to install dependencies
3. Run `npm run setup` to onboard and configure your environment (follow the setup wizard)
4. Run `npm run deploy` to deploy your project

For detailed setup instructions, see the [Step-by-Step Configuration](#step-by-step-configuration) section below.

## Detailed Setup

### Step-by-Step Configuration

  1. **App Builder Setup**: If you do not have an App Builder environment JSON file, follow the [App Builder Setup Guide](#app-builder-setup) to create your project and download the configuration file
  1. **Repository Setup**: [Create a repository](https://github.com/new?template_name=aem-commerce-prerender&template_owner=adobe-rnd) from the template in your organization and clone it to your local machine. Run `npm install` to install dependencies
  1. **Download Configuration**: Download your App Builder project JSON file from the Developer Console (click "Download All" in the top-right)
  1. Run `npm run setup` to onboard and configure your environment. The wizard will guide you through the configuration process:
     * **Step 1-2**: Provide your App Builder credentials and site information
     * **Step 3 - Advanced Settings**: The wizard will automatically detect and populate default values for `CONTENT_URL`, `STORE_URL`, `PRODUCTS_TEMPLATE`, and `PRODUCT_PAGE_URL_FORMAT` based on your site configuration. You can review and customize these settings in the advanced settings section. A `.env` file will be created with all necessary environment variables.
  1. **Configuration Variables**: After completing the setup wizard, the solution will use two types of configuration:
     
     **Static Configuration** (defined in `app.config.yaml`):
     * `LOG_LEVEL`: Controls the logging verbosity (default: "error")
     * `LOG_INGESTOR_ENDPOINT`: The endpoint for sending logs and statistics
     * `CONFIG_NAME`: The name of the configuration sheet (default: "config")
     
     **Environment-Specific Configuration** (stored in `.env` file):
     * `ORG`: Your GitHub organization or username
     * `SITE`: Your site/repository name
     * `CONTENT_URL`: Your AEM content URL (auto-populated by wizard)
     * `STORE_URL`: Your Commerce store URL (auto-populated by wizard)
     * `PRODUCTS_TEMPLATE`: The URL for the product template page (auto-populated by wizard). For localized sites with URLs like `https://main--site--org.aem.page/en-us/products/default`, you can use the `{locale}` token: `https://main--site--org.aem.page/{locale}/products/default`
     * `PRODUCT_PAGE_URL_FORMAT`: The URL pattern for product pages (auto-populated by wizard). Supports tokens: `{locale}`, `{urlKey}`, `{sku}`. Default pattern: `/{locale}/products/{urlKey}`. For live environments, consider using a different prefix like `/{locale}/products-prerendered/{urlKey}` for logical separation
     * `LOCALES`: Comma-separated list of locales (e.g., `en-us,en-gb,fr-fr`) or empty for non-localized sites
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

**Important**: In the prerendered PDPs, the SKU - originally parsed from the URL - can be retrieved from the meta tag `<meta name="sku">`. This way of retrieving the SKU is generally more robust and becomes a requirement when the SKU is sanitized, and therefore it is not possible to query the actual product using it, because the transformed SKU is not in Commerce Services.

### PDP Drop-in (Frontend Integration)
* One requirement could be to hide the prerendered semantic markup (the one coming from the templates and in general, the pdp-renderer action) and the advised way to do it is to simply replace the contents of `.product-details` block with the decorated HTML hosting the PDP drop-in.
* In fact, this semantic HTML provides rich information and context to LLM crawlers as well as search engine crawlers not supporting JavaScript: having JS replace that code with the UI meant for client-side rendering, means that if no JS is available the semantic HTML operates as a natural fallback.

### What's next?

 You might want to check out the [instructions and guidelines](/docs/POST-SETUP.md) around operation and maintenance of the solution

### Troubleshooting

Please follow the [runbook](/docs/RUNBOOK.md) to troubleshoot issues during development and system ops.

## Considerations & Use Cases

Some considerations around [advantages, use cases and prerequisites](/docs/USE-CASES.md).
