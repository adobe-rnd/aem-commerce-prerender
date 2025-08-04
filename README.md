# AEM Commerce Prerender

Pluggable prerendering stack for ahead-of-time data fetching and embedding in Product Pages and framework for definining rendering templates and rules.

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

  1. In case you do not have an App Builder environment JSON file, follow [these steps first](#app-builder-setup)
  1. Create a repo from template in your org by clicking [here](https://github.com/new?template_name=aem-commerce-prerender&template_owner=adobe-rnd). You can now clone the resulting repo from your org
  1. Download your AppBuilder project JSON file, you will use it to perform the initial setup wizard that will show up in the browser
  1. Run `npm run setup` to onboard and configure your environment.
  1. When you get to the step 3, expand the advanced settings and check the template URL. In case the site has localised templates, with a URL similar to `https://main--site--org.aem.page/en-us/products/default`, you can add a token `{locale}` to define a URL pattern that will be filled with the locales; the resulting URL to be provided would then be `https://main--site--org.aem.page/{locale}/products/default`
  1. A field you have to review is the `pathPrefix`: it's used to define the path under which the product pages will be served. You have to define a URI pattern and you can use the following tokens for that: `{locale}`, `{urlKey}`, `{sku}`. If you are deploying to a live environment, if needed to create logical separation, a good practice is to define a different path prefix from the one currently used, for example `/{locale}/products-prerendered/{urlKey}` when the current is `/{locale}/products/{urlKey}`. Whend ready to switch, it's possible to define it in `app.config.yaml` and then running `aio app deploy` again.
  1. At the end of the process a Site Context will be created and stored in your localStorage: this will be the authentication medium required to operate the <https://prerender.aem-storefront.com> management interface (you will be redirected to this address).
  1. Customize the code that contains the rendering logic according to your requirements, for [structured data](/actions/pdp-renderer/ldJson.js), [markup](/actions/pdp-renderer/render.js) and [templates](https://github.com/adobe-rnd/aem-commerce-prerender/tree/main/actions/pdp-renderer/templates) - more info [here](/docs/CUSTOMIZE.md)
  1. Deploy the solution with `npm run deploy`
  1. Go to the [Storefront Prerender](https://prerender.aem-storefront.com/#/change-detector) and check that the two rules for change dtetector are enabled (green circles).
  1. The system is now up and running and, in the first cycle of operation, it should publish all the products in the catalog. You can browse and count them from [here](https://prerender.aem-storefront.com/#/products)

### App Builder Setup

_For the following steps, you need the "Developer" role [in the Admin Console](https://helpx.adobe.com/enterprise/using/manage-developers.html)_

  1. Go to [https://developer.adobe.com/console](https://developer.adobe.com/console) and choose "Create project from template"
  1. Select "App Builder" and choose the environment (workspaces) according to your needs (we recommend Stage and Production as a starting point)
  1. You can leave all the other fields as per default settings; don't forget to provide a descriptive project title.
  1. After saving the newly created project, click on the workspace you want to deploy the prerendering stack to - use Stage to get started.
  1. In the top-right click "Download All": this will download a JSON file that will be used in the [setup process](#configuration-wizard).

### URLs

The product page URL and pathname are subject to the following [limits](https://www.aem.live/docs/limits#document-naming).
This means that, for example, if your pathFormat configured in app.config.yaml in your repo contains the SKU and your sku has unsupported characters, the resulting url is, by default, sanitized. For example: `MY_PRODUCT_123` becomes `my-product-123`

### PDP Drop-in (frontend)

* In the prerendered PDPs, the SKU - originally parsed from the URL - can be retrieved from the meta tag `meta[name="sku"]`. This way of retrieving the sku is generally more robust and becomes a requirement when the sku is sanitized, and therefore is not possible to query the actual product using it, because the transformed SKU is not in CS.
* One requirement could be to hide the prerendered semantic markup (the one coming from the templates and in general, the pdp-renderer action) and the advised way to do it is to simply replace the contents of `.product-details` block with the decorated html hosting the PDP drop-in.
* In fact, this semantic HTML provides rich information and context to LLM crawlers as well as search engine crawlers not supporting javascript: having js replace that code with the UI meant for client side rendering, means that if no js is available the semantic html operates as a natural fallback.

### What's next?

 You might want to check out the [instructions and guidelines](/docs/POST-SETUP.md) around operation and maintenance of the solution

## Considerations & Use Cases

 Few considerations around advantages, use cases and prerequisites are available in the [dedicated page](/docs/USE-CASES.md)
