# Runbook
## Product change detector (aka "poller")

It runs a cycle every 5 minutes (by default, and this value can be changed in aio.app.yamml), checking whether a product's lat modified date and resulting markup changed: the product page is previewed and the preview is then compared with the one stored in a cloud storage bucket. Logic is defined in [poller.js](../actions/check-product-changes/poller.js)

### Force re-publishing all PDPs

1. Go to https://prerender.aem-storefront.com/#/markup-storage
2. Make sure the right context is selected (top-right dropdown)
3. Click on "Reset Products List"
4. Click on "Trigger Product Scraper"
5. Wait for 5 minutes, the system will reprocess all the products

### Operation

1. If a product page returns a 404, you can first check the list in the (Management Tool)[https://prerender.aem-storefront.com/#products]; if your search returns no results, it is very likely that the product was not published.
1. You can check the activations (cycles) from `aio rt activations list` command (see also [this guide](https://developer.adobe.com/app-builder/docs/get_started/runtime_getting_started/activations)):

```bash
(base) ➜  aem-commerce-prerender-mycompany git:(main) aio rt activation list
(node:99989) [DEP0040] DeprecationWarning: The `punycode` module is deprecated. Please use a userland alternative instead.
(Use `node --trace-deprecation ...` to show where the warning was created)
 ›   Warning: @adobe/aio-cli update available from 10.3.3 to 10.3.4.
 ›   Run npm install -g @adobe/aio-cli to update.
 Datetime        Status   Kind      Version    Activation ID                    Start Wait Init Duration Entity
 ─────────────── ──────── ───────── ──────── ─ ──────────────────────────────── ───── ──── ──── ──────── ──────────────────────────────────────
 07/10 15:56:16  success  nodejs:22 0.0.17     d760eac2bf1049eea0eac2bf1019eec0 warm  17   0    632ms    aem-commerce-ssg/check-product-changes
 07/10 15:56:16  success  trigger   0.0.17     00df8e280dbd4a1d9f8e280dbdca1d8b --    --   --   --       productPollerTrigger
 07/10 15:51:16  success  trigger   0.0.17     19c79023a2ed41c4879023a2edd1c4ca --    --   --   --       productPollerTrigger
 07/10 15:46:16  success  nodejs:22 0.0.17     e94bad18d95d4ad18bad18d95dbad1a5 warm  38   0    576ms    aem-commerce-ssg/check-product-changes
 07/10 15:46:16  success  trigger   0.0.17     b25b4bc027af4d109b4bc027afcd1033 --    --   --   --       productPollerTrigger
 07/10 15:41:16  success  nodejs:22 0.0.17     e6e7d6b0b7054da3a7d6b0b705fda397 warm  44   0    600ms    aem-commerce-ssg/check-product-changes
 07/10 15:41:16  success  trigger   0.0.17     6fa7b2d265d1409ea7b2d265d1e09ee0 --    --   --   --       productPollerTrigger
 07/10 15:36:24  success  nodejs:22 0.0.17     02122ee8933f441c922ee8933f841c87 cold  8335 919  601127ms aem-commerce-ssg/check-product-changes
 07/10 15:36:16  success  trigger   0.0.17     3ef49e6bcccf4876b49e6bcccfc876ef --    --   --   --       productPollerTrigger
 07/10 15:31:16  success  nodejs:22 0.0.17     a589bc13040045e989bc130400c5e9f5 warm  40   0    492ms    aem-commerce-ssg/check-product-changes
```

you may notice that the line

```bash
 07/10 15:36:24  success  nodejs:22 0.0.17     02122ee8933f441c922ee8933f841c87 cold  8335 919  601127ms aem-commerce-ssg/check-product-changes
```

reports an execution time of `601127ms` which means that, very likely, it detected changes in some products and generated product pages
you can then check the returned state (results) via 
```bash
aio rt activation get 02122ee8933f441c922ee8933f841c87
```

```json
{
  "actionHost": "10.152.172.203",
  "activationId": "6d5d6a596aee40339d6a596aee50338b",
  "annotations": [
    {
      "key": "path",
      "value": "12345-eeeee-q74ujifo09/aem-commerce-ssg/check-product-changes"
    },
    {
      "key": "waitTime",
      "value": 3353
    },
    {
      "key": "kind",
      "value": "nodejs:22"
    },
    {
      "key": "timeout",
      "value": false
    },
    {
      "key": "limits",
      "value": {
        "concurrency": 200,
        "logs": 10,
        "memory": 512,
        "timeout": 3600000
      }
    },
    {
      "key": "initTime",
      "value": 860
    }
  ],
  "duration": 604031,
  "end": 1752143183712,
  "invokerInstanceId": {
    "instance": 3,
    "instanceType": "invoker",
    "isBlackbox": false,
    "uniqueName": "rt-invoker-3",
    "userMemory": "1500000000000000 B"
  },
  "logs": [],
  "name": "check-product-changes",
  "namespace": "12345-eeeee-q74ujifo09",
  "podName": "wskrt-invoker-33-2692638f-3456-chec",
  "publish": false,
  "response": {
    "result": {
      "elapsed": 602355,
      "memoryUsage": {
        "external": "5.1 MB",
        "heapTotal": "68.77 MB",
        "heapUsed": "63.02 MB",
        "rss": "201.46 MB"
      },
      "state": "completed",
      "status": {
        "failed": 4331,
        "ignored": 688,
        "published": 8,
        "unpublished": 0
      },
      "timings": {
        "get-changed-products": {
          "avg": 6379,
          "max": 8128,
          "min": 4630,
          "n": 2
        },
        "get-discovered-products": {
          "avg": 77,
          "max": 82,
          "min": 72,
          "n": 2
        },
        "previewDuration": {
          "avg": 13403.511363636364,
          "max": 17724,
          "min": 7591,
          "n": 88
        },
        "published-products": {
          "avg": 436996.5,
          "max": 593175,
          "min": 280818,
          "n": 2
        },
        "unpublished-products": {
          "avg": 0,
          "max": 0,
          "min": 0,
          "n": 2
        }
      }
    },
    "size": 543,
    "status": "success",
    "success": true
  },
  "start": 1752142579681,
  "subject": "12345-eeeee-q74ujifo09",
  "version": "0.0.17"
}
```

specifically

```json
{ 
    "status": {
        "failed": 4331,
        "ignored": 688,
        "published": 8,
        "unpublished": 0
      }
}
```

you can see that there are 4k errored products.

1. So, we can check the logs via 

```bash
aio rt activation logs 02122ee8933f441c922ee8933f841c87
```

The activations that last few seconds are most of time "skipped" ones.
This happens because we prevent concurrency, therefore we have a mutex that is used to keep just a single instance of the action activate: the `running` state key of [Adobe AppBuilder State](https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/application-state)

if the logs return errors, you can dig into them and check the issue(s).

```bash
2025-07-10T10:17:18.143Z       stdout: 2025-07-10T10:17:18.143Z [main /12345-eeeee-q74ujifo09/aem-commerce-ssg/check-product-changes] info: Queues: preview=38, publish=0, unpublish live=0, unpublish preview=0, inflight=2, in queue=42
2025-07-10T10:17:20.143Z       stdout: 2025-07-10T10:17:20.143Z [main /12345-eeeee-q74ujifo09/aem-commerce-ssg/check-product-changes] info: Queues: preview=36, publish=0, unpublish live=0, unpublish preview=0, inflight=2, in queue=44
2025-07-10T10:17:21.440Z       stdout: 2025-07-10T10:17:21.440Z [main /12345-eeeee-q74ujifo09/aem-commerce-ssg/check-product-changes] error: Job preview/job-2025-07-10-10-17-08-00c280e4 completed with failures: 50 failed jobs, processed 50 jobs of 50.
```

now, we can see at least one error and a whole batch that failed publish ops

`preview/job-2025-07-10-10-17-08-00c280e4`

1. You can go to the [Job Status](https://prerender.aem-storefront.com/#jobs) page, paste the above and check the status

```json
{
	"topic": "preview",
	"user": "helix@adobe.com",
	"name": "job-2025-07-09-11-32-29-5a2302f6",
	"state": "stopped",
	"createTime": "2025-07-09T11:32:29.530Z",
	"data": {
		"paths": [
			"/en-us/products/my-awesome-product-sku1234",
		],
		"forceUpdate": true,
		"phase": "completed",
		"resources": [
			{
				"status": 404,
				"path": "/en-us/products/my-awesome-product-sku1234",
				"resourcePath": "/en-us/products/my-awesome-product-sku1234.md",
				"source": {
					"name": "my-awesome-product-sku1234.md",
					"contentType": "text/markdown; charset=utf-8",
					"location": "https://firefly.azureedge.net/126233234826324i638463-public/public/pdps/en-us/products/my-awesome-product-sku1234",
					"type": "markup"
				},
				"error": "Unable to fetch '/en-us/products/my-awesome-product-sku1234.md' from 'html2md': (404) - resource not found: https://firefly.azureedge.net/126233234826324i638463-public/public/pdps/en-us/products/my-awesome-product-sku1234.html",
				"errorCode": "AEM_BACKEND_FETCH_FAILED"
			}
        ]
    }
}
```

1. Should you get the above (error 404 with AEM_BACKEND_FETCH_FAILED) it means that:
    - the files have not been generated
    - the files miss a required extension (.html, please check the SiteConfig in AEM Admin API)
    - exception in rendering the files
    - the storage bucket is not reachable (mostly because the overlay URL in the SiteConfig is wrong)
    - transient errors, but these should be fixed by the retry cycles in the product change detector



## Renderer

Issues with the rendering process can be found in the logs from above.

## Product scraper

from `aio rt activations list` you might notice the activations of the product scraper action (fetch-all-products)

```bash
 Datetime        Status   Kind      Version    Activation ID                    Start Wait Init Duration Entity
 ─────────────── ──────── ───────── ──────── ─ ──────────────────────────────── ───── ──── ──── ──────── ──────────────────────────────────────
 07/11 13:26:25  success  nodejs:22 0.0.16     5867c974307c4824a7c974307ce82490 cold  8391 871  7928ms   aem-commerce-ssg/fetch-all-products
```

here you can inspect the logs in case of any issue, following the same workflow as per the other action. Most issues here are caused by misconfiguration in the project's yaml file or in the catalog service config in SiteConfig.

## Jobs

https://www.aem.live/docs/admin.html#tag/job/operation/getJobDetails
