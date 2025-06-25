/* eslint-disable no-await-in-loop */
/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable node/no-unsupported-features/es-syntax */
import 'dotenv/config';
import { exit, env } from 'process';
import aioRuntime from '@adobe/aio-lib-runtime';
import fs from 'fs';
import * as vega from 'vega';
import * as vegaLite from 'vega-lite';
import path from 'path';
import { mkdir } from 'fs/promises';
import { Command } from 'commander';

const program = new Command();

program
  .name('get-stats')
  .description('Generate statistics from Adobe I/O Runtime activations')
  .requiredOption('-d, --date <DD-MM-YYYY>', 'specify the target date')
  .requiredOption('-f, --folder <path>', 'specify the output folder')
  .option('-c, --chart', 'generate chart')
  .option('-j, --json', 'generate JSON file with previewed URLs')
  .option('-x, --csv', 'generate CSV file with statistics')
  .addHelpText('after', '\nAt least one of -c, -j, or -x must be specified')
  .action((options) => {
    // Validate that at least one output format is selected
    if (!options.chart && !options.json && !options.csv) {
      console.error('Error: At least one of -c (chart), -j (json), or -x (csv) options must be specified');
      program.help();
    }
  });

program.parse();

const options = program.opts();

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function generateChart(rawData, filename) {
  const processedData = rawData.flatMap(([id, startDate, duration, state, failed,
    ignored, published, unpublished, previewDuration, previewOnly]) => [
    {
      date: startDate,
      value: failed,
      metric: 'Failed',
      type: 'count',
      previewOnly: previewOnly ? 'Preview Only' : 'Normal'
    },
    {
      date: startDate,
      value: published,
      metric: 'Published',
      type: 'count',
      previewOnly: previewOnly ? 'Preview Only' : 'Normal'
    },
    {
      date: startDate,
      value: unpublished,
      metric: 'Unpublished',
      type: 'count',
      previewOnly: previewOnly ? 'Preview Only' : 'Normal'
    },
    {
      date: startDate,
      value: duration,
      metric: 'Duration',
      type: 'duration',
      previewOnly: previewOnly ? 'Preview Only' : 'Normal'
    },
  ]);

  const spec = {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    width: 1024,
    height: 1024,
    data: { values: processedData },
    encoding: {
      x: {
        field: 'date',
        type: 'temporal',
        axis: { title: 'Date' },
      },
    },
    layer: [
      {
        transform: [{ filter: "datum.type === 'count'" }],
        mark: {
          type: 'line',
          strokeDash: {
            condition: {
              test: "datum.previewOnly === 'Preview Only'",
              value: [6, 4]  // dashed line for preview-only mode
            },
            value: [0]  // solid line for normal mode
          },
          strokeWidth: {
            condition: {
              test: "datum.previewOnly === 'Preview Only'",
              value: 2  // thicker line for preview-only mode
            },
            value: 1  // normal width for normal mode
          }
        },
        encoding: {
          y: {
            field: 'value',
            type: 'quantitative',
            axis: { title: 'Count' },
          },
          color: {
            field: 'metric',
            type: 'nominal',
            legend: { title: 'Metrics (Count)' },
            scale: {
              domain: ['Failed', 'Published', 'Unpublished'],
              range: ['#ff0000', '#00ff00', '#0000ff'],
            },
          },
          strokeDash: {
            field: 'previewOnly',
            type: 'nominal',
            legend: { title: 'Mode' }
          }
        },
      },
      {
        transform: [{ filter: "datum.type === 'duration'" }],
        mark: {
          type: 'line',
          strokeDash: {
            condition: {
              test: "datum.previewOnly === 'Preview Only'",
              value: [6, 4]
            },
            value: [2, 2]
          },
          strokeWidth: {
            condition: {
              test: "datum.previewOnly === 'Preview Only'",
              value: 2
            },
            value: 1
          }
        },
        encoding: {
          y: {
            field: 'value',
            type: 'quantitative',
            axis: { title: 'Duration (ms)' },
            scale: { zero: true },
          },
          color: {
            field: 'metric',
            type: 'nominal',
            scale: {
              domain: ['Duration'],
              range: ['#FFA500'],
            },
            legend: { title: 'Duration' },
          },
          strokeDash: {
            field: 'previewOnly',
            type: 'nominal',
            legend: { title: 'Mode' }
          }
        },
      },
    ],
    resolve: {
      scale: {
        y: 'independent',
        color: 'independent',
      },
    },
  };

  const vegaSpec = vegaLite.compile(spec).spec;
  const view = new vega.View(vega.parse(vegaSpec), { renderer: 'canvas' });

  return view.toCanvas()
    .then((canvas) => {
      const stream = canvas.createPNGStream();
      const writeStream = fs.createWriteStream(filename);
      
      return new Promise((resolve, reject) => {
        stream.pipe(writeStream);
        writeStream.on('finish', () => {
          resolve();
        });
        writeStream.on('error', reject);
      });
    })
    .catch(console.error);
}

let runtime;
const previewedURLs = [];

const {
  AIO_RUNTIME_NAMESPACE,
  AIO_runtime_namespace,
  AIO_RUNTIME_AUTH,
  AIO_runtime_auth,
} = env;

const namespace = AIO_RUNTIME_NAMESPACE || AIO_runtime_namespace;
const auth = AIO_RUNTIME_AUTH || AIO_runtime_auth;

// Check only required env vars
if (!namespace || !auth) {
  console.log('Missing required environment variables');
  exit(1);
}

function parseDateDDMMYYYY(dateStr) {
  // Expected format: dd-mm-yyyy
  if (!/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) {
    throw new Error('Invalid date format. Please use DD-MM-YYYY format (e.g., 20-03-2024)');
  }
  
  const [day, month, year] = dateStr.split('-').map(num => parseInt(num, 10));
  
  // Create date in UTC at start of day
  const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  
  // Validate the parsed date
  if (isNaN(date.getTime())) {
    throw new Error('Invalid date. Please provide a valid date in DD-MM-YYYY format');
  }
  
  return date;
}

async function* listActivations(targetDate) {
  // Get total count first
  const { activations: totalCount } = await runtime.activations.list({ count: true });
  console.log(`Total available activations: ${totalCount}`);
  
  // Create start and end timestamps for the target day
  const startTime = new Date(Date.UTC(
    targetDate.getUTCFullYear(),
    targetDate.getUTCMonth(),
    targetDate.getUTCDate(),
    0, 0, 0, 0
  ));
  
  const endTime = new Date(Date.UTC(
    targetDate.getUTCFullYear(),
    targetDate.getUTCMonth(),
    targetDate.getUTCDate(),
    23, 59, 59, 999
  ));

  // Get next day's start for boundary check
  const nextDayStart = new Date(Date.UTC(
    targetDate.getUTCFullYear(),
    targetDate.getUTCMonth(),
    targetDate.getUTCDate() + 1,
    0, 0, 0, 0
  ));

  console.log(`Will fetch activations between:
Start: ${startTime.toISOString()}
End: ${endTime.toISOString()}`);

  let batchNumber = 1;
  let shouldStopCompletely = false;

  for (let skip = 0; skip < totalCount && !shouldStopCompletely; skip += 50) {
    try {
      console.log(`\nFetching batch ${batchNumber} (offset: ${skip})...`);
      const batch = await runtime.activations.list({ limit: 50, skip });
      console.log(`Retrieved ${batch.length} activations in this batch`);
      
      if (batch.length === 0) {
        console.log('No more activations available, stopping pagination');
        break;
      }

      for (const activation of batch) {
        // Check the date first, before any other filtering
        const activationTime = new Date(activation.start);

        // If we've gone past our target date (future), stop completely
        if (activationTime >= nextDayStart) {
          console.log(`Found activation from ${activationTime.toISOString()}, which is beyond our target date ${targetDate.toISOString()}, stopping search completely`);
          shouldStopCompletely = true;
          break;
        }

        // If we've found a date before our target date, stop completely
        if (activationTime < startTime) {
          console.log(`Found activation from ${activationTime.toISOString()}, which is before our target date ${targetDate.toISOString()}, stopping search completely`);
          shouldStopCompletely = true;
          break;
        }

        // At this point, we know the activation is within our target day
        // Now we can apply other filters
        if (activation.name === 'check-product-changes') {
          yield activation;
        }
      }

      if (shouldStopCompletely) {
        console.log('Breaking out of pagination loop due to finding activation outside target date range');
        break;
      }

      batchNumber++;
    } catch (error) {
      console.error(`Error fetching batch ${batchNumber} at offset ${skip}:`, error);
      break;
    }
  }

  console.log('\nFinished fetching all relevant batches');
}

async function checkNewActivations(targetDate) {
  // Create output directory if it doesn't exist
  try {
    await mkdir(options.folder, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      console.error('Error creating output directory:', error);
      throw error;
    }
  }

  // Format the date for comparison (in UTC)
  const targetDayString = targetDate.toISOString().split('T')[0];

  // Add counters for tracking totals
  let totalPublished = 0;
  let totalUnpublished = 0;
  let totalFailed = 0;
  let firstExecution = null;
  let lastExecution = null;

  console.log('\nSearching activations for date:', targetDayString);

  // Only create streams and files if chart is requested
  let dataFilename;
  let chartFilename;
  let activationsStream;
  let streamFinished;

  if (options.chart) {
    dataFilename = path.join(options.folder, `activations_series_${targetDate.getUTCDate().toString().padStart(2, '0')}-${
      (targetDate.getUTCMonth() + 1).toString().padStart(2, '0')}-${
      targetDate.getUTCFullYear()}.tmp.json`);
      
    chartFilename = path.join(options.folder, `chart_${targetDate.getUTCDate().toString().padStart(2, '0')}-${
      (targetDate.getUTCMonth() + 1).toString().padStart(2, '0')}-${
      targetDate.getUTCFullYear()}.png`);

    activationsStream = fs.createWriteStream(dataFilename);
    
    streamFinished = new Promise((resolve, reject) => {
      activationsStream.on('finish', resolve);
      activationsStream.on('error', reject);
    });

    activationsStream.write('[\n');
  }

  try {
    let isFirstLine = true;
    let matchCount = 0;
    let totalChecked = 0;
    let csvData;

    // Pass targetDate to listActivations
    for await (const activation of listActivations(targetDate)) {
      totalChecked++;
      const activationDate = new Date(activation.start);

      if (activation.name === 'check-product-changes') {
        console.log(`plotting activation ${activation.activationId} [${activationDate.toLocaleString()} ${Intl.DateTimeFormat().resolvedOptions().timeZone }]`);

        const execution = await runtime.activations.get({ activationId: activation.activationId });
        if (execution.response.result?.result?.state === 'skipped') continue;

        const rawLogs = await runtime.activations.logs({ activationId: activation.activationId });

        const LOG_PREFIX = 'stdout: Previewed';

        const activationPreviewedURLs = (rawLogs?.logs || []).filter(logLine => logLine.includes(LOG_PREFIX)).map(logLine => logLine.split(LOG_PREFIX)[1].trim());
        previewedURLs.push(...activationPreviewedURLs);

        // Format activation data
        const startDate = new Date(execution.start).toISOString();
        const executionDate = new Date(execution.start);
        
        // Update execution time tracking
        if (!firstExecution || executionDate < firstExecution) {
          firstExecution = executionDate;
        }
        if (!lastExecution || executionDate > lastExecution) {
          lastExecution = executionDate;
        }

        const { result } = execution.response;
        const status = result?.status || {};
        const timings = result?.timings || {};
        
        // Update totals
        totalPublished += status.published || 0;
        totalUnpublished += status.unpublished || 0;
        totalFailed += status.failed || 0;

        if (options.chart) {
          const activationData = [
            execution.activationId,
            startDate,
            execution.duration,
            result?.state || '',
            status.failed || 0,
            status.ignored || 0,
            status.published || 0,
            status.unpublished || 0,
            timings.previewDuration?.avg || 0,
            status.previewOnly,
          ];

          // Write to file with proper JSON formatting
          if (!isFirstLine) {
            activationsStream.write(',\n');
          }
          activationsStream.write(JSON.stringify(activationData, null, 2));
          isFirstLine = false;
        }

        // Store data for CSV if option is enabled
        if (options.csv) {
          if (!csvData) {
            csvData = [];
            // Add CSV header
            csvData.push([
              'Activation ID',
              'Start Date',
              'Duration (ms)',
              'State',
              'Failed',
              'Ignored',
              'Published',
              'Unpublished',
              'Preview Duration (avg ms)',
              'Preview Only'
            ].join(','));
          }
          csvData.push([
            execution.activationId,
            startDate,
            execution.duration,
            result?.state || '',
            status.failed || 0,
            status.ignored || 0,
            status.published || 0,
            status.unpublished || 0,
            timings.previewDuration?.avg || 0,
            status.previewOnly || false
          ].join(','));
        }
        matchCount++;
      }
    }

    console.log(`\nSummary:`);
    console.log(`Total activations checked: ${totalChecked}`);
    console.log(`Matching activations found: ${matchCount}`);
    console.log(`Target date: ${targetDayString}`);
    console.log(`\nOperation totals for ${targetDayString}:`);
    console.log(`Publish ops: ${totalPublished}`);
    console.log(`Unpublish ops: ${totalUnpublished}`);
    console.log(`Failed ops ${totalFailed}`);
    
    if (firstExecution && lastExecution) {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      console.log(`\nExecution time range (${timeZone}):`);
      console.log(`From: ${firstExecution.toLocaleTimeString()}`);
      console.log(`To: ${lastExecution.toLocaleTimeString()}`);
    }

    if (options.chart) {
      // Close the JSON array
      activationsStream.write('\n]');
      activationsStream.end();

      await streamFinished;
      await wait(100);

      // Generate chart from the collected data
      console.log('Generating chart...');
      const rawData = JSON.parse(fs.readFileSync(dataFilename, 'utf8'));
      if (rawData.length > 0) {
        await generateChart(rawData, chartFilename);
        // Delete JSON file after chart generation
        await fs.promises.unlink(dataFilename);
        console.log('Temporary JSON file deleted');
        console.log(`Chart saved to: ${path.resolve(chartFilename)}`);
      } else {
        console.log('No data points to generate chart');
      }
    }

    // Write CSV file if option is enabled
    if (options.csv && csvData?.length > 0) {
      const csvFilename = path.join(options.folder, `${targetDate.getUTCDate().toString().padStart(2, '0')}-${
        (targetDate.getUTCMonth() + 1).toString().padStart(2, '0')}-${
        targetDate.getUTCFullYear()}.csv`);
      fs.writeFileSync(csvFilename, csvData.join('\n'));
      console.log(`CSV statistics written to ${csvFilename}`);
    }

  } catch (error) {
    console.error('Error:', error);
    // Clean up JSON file if it exists
    if (options.chart) {
      try {
        await fs.promises.unlink(dataFilename);
      } catch (cleanupError) {
        console.error('Error cleaning up JSON file:', cleanupError);
      }
      activationsStream.end();
    }
  }

  console.log(`Previewed ${previewedURLs.length} URLs`);
  if (options.json) {
    const jsonFilename = path.join(options.folder, `${targetDate.getUTCDate().toString().padStart(2, '0')}-${
      (targetDate.getUTCMonth() + 1).toString().padStart(2, '0')}-${
      targetDate.getUTCFullYear()}.json`);
    fs.writeFileSync(jsonFilename, previewedURLs.join('\n'));
    console.log(`URLs written to ${jsonFilename}`);
  }
}

async function main() {
  // Validate date format before proceeding
  let targetDate;
  try {
    targetDate = parseDateDDMMYYYY(options.date);
  } catch (error) {
    console.error(error.message);
    program.help(); // Show help instead of just exiting
  }

  // Initialize runtime with Adobe I/O credentials
  try {
    runtime = await aioRuntime.init({
      apihost: "https://adobeioruntime.net",
      api_key: auth,
      namespace,
      debug: true,
    });
  } catch (error) {
    console.error('Failed to initialize Adobe I/O Runtime:', error.message);
    process.exit(1);
  }

  console.log('Target date:', targetDate.toISOString());

  await checkNewActivations(targetDate);
}

// Only run if not being imported as a module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
}
