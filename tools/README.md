# Tools

This directory contains utility scripts for various tasks related to the AppBuilder package. Below are the details on how to use each script.

## `refresh-pdps.js`

This script gracefully pauses execution of the poller, and performs a 'cold start': the poller will then re-preview and re-publish all the products in the catalog.
The operation happens in the background and the script checks that the cold start was successfully triggered, exiting 0.

### Usage

`-l, --locales <locales>: Comma-separated list of locales (or stores) to delete. For example: en,fr,de`

## `check-products-count.js`

This script checks the product count consistency between the `published-products-index` and the Adobe Commerce store.
The products count is retrieved in Adobe Commerce via a Live Search query.
This script is a starting point to investigate issues in PDP publishing or rendering.

### Usage

1. Ensure you have the required environment variables set in your `.env` file:
    ```bash
    COMMERCE_STORE_CODE=<your_store_code>
    COMMERCE_STORE_URL=<your_store_url>
    COMMERCE_CONFIG_NAME=<your_config_name>
    ```

2. Run the script using Node.js:
    ```bash
    node check-products-count.js
    ```

3. The script will throw an error if the product counts do not match, indicating the expected and actual product counts. PLEASE NOTE: the number of products listed is just an indication to check for "macroscopic" failures, slight differences might be due to specific Commerce configs/attributes for certain products which might not show up in the query results.
4. In case of a mismatch, it is advised to check the logs and statistics of the service, by using [Adobe I/O cli](https://developer.adobe.com/runtime/docs/guides/getting-started/activations/) tool and looking at the invocation results - which are quite descriptive, to have more specific insights on the nature of the issue (whether it's a failed publish task, for example).

Inovcation results (example):

```json
{ 
    "result": {
    "elapsed": 13001,
    "state": "completed",
    "status": {
        "failed": 29,
        "ignored": 4572,
        "published": 0,
        "unpublished": 0
    },
    "timings": {
        "fetchedLastModifiedDates": {
            "avg": 5710,
            "max": 5710,
            "min": 5710,
            "n": 1
        },
        "fetchedSkus": {
            "avg": 0,
            "max": 0,
            "min": 0,
            "n": 1
        },
        "loadedState": {
            "avg": 47,
            "max": 47,
            "min": 47,
            "n": 1
        },
        "previewDuration": {
            "avg": 1677.2758620689656,
            "max": 3180,
            "min": 1037,
            "n": 29
        },
        "publishedPaths": {
            "avg": 7075,
            "max": 7075,
            "min": 7075,
            "n": 1
        },
        "unpublishedPaths": {
            "avg": 143,
            "max": 143,
            "min": 143,
            "n": 1
        }
    }
}
```

## `check-errors.sh`

This shell script lists Adobe I/O Runtime activations that ended with an error (`statusCode != 0`), then prints full activation details and logs for each ID. It paginates through `aio rt activation list` so you are not limited to the first page of results.

Use it when you need a quick view of recent failures without clicking through the Runtime UI.

### Prerequisites

- [Adobe I/O CLI](https://developer.adobe.com/runtime/docs/guides/getting-started/activations/) (`aio`) with Runtime access configured for the namespace you want to inspect.
- `jq` installed and on your `PATH`.

### Usage

From the `tools` directory (or pass the path to the script):

```bash
./check-errors.sh
./check-errors.sh --hours 15
```

### Options

```
--hours N    Only consider activations from the last N hours (maps to aio rt activation list --since).
```

With no options, all pages of activations are scanned (until a page returns fewer than 50 items).

### Behavior

1. Fetches activations in pages of 50, optionally filtered by `--since` when `--hours` is set.
2. Collects activation IDs where `statusCode` is not `0`.
3. If none are found, prints `No error activations found.` and exits successfully.
4. Otherwise prints each error activation ID, then runs `aio rt activation get <id>` and `aio rt activation logs <id>` for each (failures on individual gets/logs are ignored so the script continues).

## `get-stats.js`

This script is used to generate charts and statistics from Adobe I/O Runtime poller activations. It can output data in multiple formats: a PNG chart, a JSON file with previewed URLs, and/or a CSV file with detailed statistics.

### Usage

1. Ensure you have the required environment variables set in your `.env` file:
    ```bash
    AIO_RUNTIME_NAMESPACE=<your_namespace>
    AIO_RUNTIME_AUTH=<your_auth_key>
    ```

2. Run the script:
    ```bash
    node get-stats.js [options]
    ```

### Options

```
Options:
  -d, --date <DD-MM-YYYY>  Required. Specify the target date
  -f, --folder <path>      Required. Specify the output folder
  -c, --chart             Generate chart (outputs chart_dd-mm-yyyy.png)
  -j, --json             Generate JSON file with previewed URLs (outputs dd-mm-yyyy.json)
  -x, --csv              Generate CSV file with statistics (outputs dd-mm-yyyy.csv)
  -h, --help             Display help for command
```

At least one of `-c`, `-j`, or `-x` must be specified.

### Output Files

The script generates files in the specified output folder with the following naming convention:

- Chart: `chart_dd-mm-yyyy.png`
- JSON: `dd-mm-yyyy.json` (contains list of previewed URLs)
- CSV: `dd-mm-yyyy.csv` (contains detailed statistics)

The CSV file includes the following columns:
- Activation ID
- Start Date
- Duration (ms)
- State
- Failed count
- Ignored count
- Published count
- Unpublished count
- Preview Duration (avg ms)
- Preview Only flag

### Examples

```bash
# Generate all outputs (chart, JSON, and CSV)
node get-stats.js -d 20-03-2024 -f output -c -j -x

# Generate only CSV statistics
node get-stats.js -d 20-03-2024 -f output -x

# Generate chart and JSON
node get-stats.js -d 20-03-2024 -f output -c -j

# Using long-form options
node get-stats.js --date 20-03-2024 --folder output --chart --json --csv
```

