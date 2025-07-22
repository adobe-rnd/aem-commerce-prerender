# AEM Commerce Prerender

Pluggable prerendering stack for ahead-of-time data fetching and embedding in Product Pages and framework for definining rendering templates and rules.

* ⚡️ Boost SEO by pre-rendering human-readable product data in the markup
* 💉 Inject JSON-LD Structured data in the page source code
* 📈 Aggregate data sources and inject resulting data ahead-of-time
* ⚙️ Define your custom rendering logic
* 🧠 Offload intensive computation to the rendering phase

## Architecture
<details>
  <summary>Show the details</summary>

  ![Architecture](/docs/architecture.jpg)

</details>

## Getting started

  Setup of prerequisites and Edge Delivery Services is guided and some steps are automated.

### Configuration Wizard
  1. In case you do not have an App Builder environment or a properly scoped AEM Admin API Key, follow [these steps first](#app-builder-setup)
  1. Create a repo from template in your org by clicking [here](https://github.com/new?template_name=aem-commerce-prerender&template_owner=adobe-rnd). You can now clone the resulting repo from your org, and run `npm run setup`
  1. Prepare your Helix Admin Key, Helix API key and AppBuilder project JSON file, you will use them to perform the initial setup wizard that will show up in the browser
  1. Customise the code that contains the rendering logic according to your requirements, for [structured data](/actions/pdp-renderer/ldJson.js), [markup](/actions/pdp-renderer/render.js) and [templates](https://github.com/adobe-rnd/aem-commerce-prerender/tree/main/actions/pdp-renderer/templates) - more info [here](/docs/CUSTOMIZE.md)
  1. Deploy the solution with `npm run deploy`
  
### App Builder Setup

_For the following steps, you need the "Developer" role [in the Admin Console](https://helpx.adobe.com/enterprise/using/manage-developers.html)_

  1. Go to [https://developer.adobe.com/console](https://developer.adobe.com/console) and choose "Create project from template"
  1. Select "App Builder" and choose the environments (workspaces) according to your needs (we recommend Stage and Production as a starting point)
  1. You can leave all the other fields as per default settings; don't forget to provide a descriptive project title.
  1. After saving the newly created project, click on the workspace you want to deploy the prerendering stack to - use Stage to get started.
  1. In the top-right click "Download All": this will download a JSON file that will be used in the setup process.

### Helix API key
  1. A service token from Helix is needed to let the service publish the PDP pages automatically. In order to get one, use your favorite REST client and make a request:
  2. 
     `POST https://admin.hlx.page/config/{org}/sites/{site}/apiKeys.json`
     
     or, if you are using Helix profiles for your site:
     
     `POST https://admin.hlx.page/config/{org}/profiles/{profile}/apiKeys.json`
     
     Request body:
     ```json
     {
      "description": "Key used by PDP Prerender components [DEV]",
      "roles": [
        "preview",
        "publish",
        "config_admin"
      ]
     }
     ```
     3. get the token from the response body (`value` key) and store it, you will use it in the [next steps](#configuration-wizard)

     ```json
     {
        "id": "a7t8fiouh==",
        "description": "string",
        "value": "eih23iuy2goroiy32g3iyri2bfein",
        "created": "2019-08-24T14:15:22Z",
        "expiration": "2019-08-24T14:15:22Z",
        "subject": "string"
     }
     ```

### Frontend & PDP Drop-in

### What's next?
 You might want to check out the [instructions and guidelines](/docs/POST-SETUP.md) around operation and maintenance of the solution

## Considerations & Use Cases
 Few considerations around advantages, use cases and prerequisites are available in the [dedicated page](/docs/USE-CASES.md)
