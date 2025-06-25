## Considerations:

  * how many skus Customer has in the catalog, per store?
  * how many variants (as above)?
  * e2e latency requirements, from when the change is set to when it is reflected in a public pdp page
  * is the AppBuilder environment with Runtime enabled?
  * is helix5 enabled?
  * is staging site repoless or backed by a different repo?
  * get helix credentials for the environments/sites
  * define the rendering logic in a way that the output [html is semantic](https://www.aem.live/developer/markup-reference) for Helix pipelines
  * develop the PDP page leveraging either the [dropin slots](https://experienceleague.adobe.com/developer/commerce/storefront/dropins/all/slots/) and [API overrides](https://experienceleague.adobe.com/developer/commerce/storefront/dropins/all/extending/) to retrieve the data
  * pricing: using a midlleware/api mesh to route the customer to the respective price segment is highly recommended

## When Static Rendering of Product Pages is needed

  * [Folder Mapping](https://www.aem.live/developer/folder-mapping) is deprecated. Please contact us if you have a use case for folder mapping, we will help to find the best solution. Existing projects using folder mapping may need to migrate to a different solution in the future. For projects currently using folder mapping in product detail pages, there are few disadvantages:
      * Supports only soft 404s instead of real HTTP 404 responses. If not implemented correctly, this can negatively affect index-ability.
      * Response from the server is basically the same for every folder mapped page. All data is added to the page using JavaScript.
  * Some services require that product detail pages return data in the initial server response:
      * Social media sites and apps (e.g. Facebook, Discord) require server-side rendered meta tags (title, description, image) to display a rich preview of shared links.
      * Frequent data changes (e.g. price and inventory) are only reliably picked up by Google Merchant Center when server-side rendered. This aspect is very important if you rely on organic traffic and the Google Shopping features.
  * These issues can be solved by applying **one** of the following methods:
      * Follow [https://experienceleague.adobe.com/developer/commerce/storefront/seo/metadata/](https://experienceleague.adobe.com/developer/commerce/storefront/seo/metadata/) to automatically create a metadata sheet which will be rendered into pages by the Edge Delivery content pipeline. This is only recommended if your products don't change frequently as changes to the sheet will invalidate the cache of all your folder mapped pages.
      * Work with your Adobe VIP team to apply static site generation of PDPs using the generic Adobe implementation. We recommend this approach if your implementation is very close to the out of the box Edge Delivery storefront.
      * Setup your own AppBuilder project based on [https://github.com/adobe-rnd/aem-commerce-ssg](https://github.com/adobe-rnd/aem-commerce-ssg) to generate PDPs. We recommend this approach if you require customizations such as rendering custom data or fetching data from custom APIs.
  * We recommend to use static generation to render only the following data:
      * OpenGraph meta tags
      * Structured product data (e.g. LD+JSON) including high frequency data (see above)
      * Basic product markup (for the visible PDP markup) with publicly available information, according to these criteria: we recommend to fetch client-side all the volatile data that is not statically rendered, as well as the data that changes frequently, like price and stock qty, although this is statically rendered and injected as structured data, as follows: ![image](https://github.com/user-attachments/assets/f8b324f5-2646-4c39-9cb3-30e224275ade)

  * If your catalog is very large, we recommend rendering only the top x products with regard to visits / purchases to not exceed the page [limit](https://www.aem.live/docs/limits#number-of-pages-per-site). For all other products, you can fallback to folder mapping.
  * Do not render any of the following:
      * Data that is specific or only visible to logged in customers (e.g. dynamic pricing).
      * Data that should not be indexed or data that is not relevant to search engines.
      * Highly volatile data which is not required by Merchant Center.

## Advantages:

  * Enhanced Product Pages: Improves product detail pages by embedding custom metadata and essential markup ahead-of-time, making them available already within the initial server response.
  * Tailored Implementation: Customize the injected [metadata](https://github.com/adobe-rnd/aem-commerce-ssg/blob/main/actions/pdp-renderer/ldJson.js) and [markup](https://github.com/adobe-rnd/aem-commerce-ssg/blob/main/actions/pdp-renderer/templates) to better suit Customer's specific requirements.
  * Boosted SEO: Significantly improves search engine crawlability and indexability for better visibility, especially in organic traffic.
  * Rich Social Media Previews: Ensures product links generate engaging and informative previews when shared on social platforms.
  * Reliable Merchant Center Data: Provides accurate and readily available product information for Google Merchant Center.
  * Improved Page Performance: Depending on the implementation, can lead to faster page load times as essential content is delivered immediately by the server, thus reducing the number of fetch/XHR requests in the frontend.