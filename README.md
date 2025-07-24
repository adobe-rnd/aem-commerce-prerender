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
  1. Prepare your AppBuilder project JSON file, you will use it to perform the initial setup wizard that will show up in the browser
  1. Run `npm run setup` to onboard and configure your environment. At the end of the process a Site Context will be created and stored in your localStorage: this will be the authentication medium required to operate the https://prerender.aem-storefront.com management interface (you will be redirected to this address).
  1. Customise the code that contains the rendering logic according to your requirements, for [structured data](/actions/pdp-renderer/ldJson.js), [markup](/actions/pdp-renderer/render.js) and [templates](https://github.com/adobe-rnd/aem-commerce-prerender/tree/main/actions/pdp-renderer/templates) - more info [here](/docs/CUSTOMIZE.md)
  1. Deploy the solution with `npm run deploy`
  1. Go to the [Storefront Prerender](https://prerender.aem-storefront.com/#/change-detector) and check that the two rules for change dtetector are enabled (green circles).
  1. THe system is now up and running and, in the first cycle of operation, it should publish all the products in the catalog. You can browse and count them from [here](https://prerender.aem-storefront.com/#/products)
  
### App Builder Setup

_For the following steps, you need the "Developer" role [in the Admin Console](https://helpx.adobe.com/enterprise/using/manage-developers.html)_

  1. Go to [https://developer.adobe.com/console](https://developer.adobe.com/console) and choose "Create project from template"
  1. Select "App Builder" and choose the environment (workspaces) according to your needs (we recommend Stage and Production as a starting point)
  1. You can leave all the other fields as per default settings; don't forget to provide a descriptive project title.
  1. After saving the newly created project, click on the workspace you want to deploy the prerendering stack to - use Stage to get started.
  1. In the top-right click "Download All": this will download a JSON file that will be used in the [setup process](#configuration-wizard).

### Frontend & PDP Drop-in
 - In general, any changes to the frontend code are outside the scope of this guide.
 - One requirement could be to hide the prerendered semantic markup (the one coming from the templates and in general, the pdp-renderer action) and the advised way to do it is to simply replace the contents of `.product-details` block with the decorated html hosting the PDP drop-in.
 - In fact, this semantic HTML provides rich information and context to LLM crawlers as well as search engine crawlers not supporting javascript: having js replace that code with the UI meant for client side rendering, means that if no js is available the semantic html operates as a natural fallback.

### What's next?
 You might want to check out the [instructions and guidelines](/docs/POST-SETUP.md) around operation and maintenance of the solution

## Considerations & Use Cases
 Few considerations around advantages, use cases and prerequisites are available in the [dedicated page](/docs/USE-CASES.md)
