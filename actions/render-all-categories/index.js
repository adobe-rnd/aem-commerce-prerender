/*

Copyright 2026 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.

*/

const { Core } = require("@adobe/aio-sdk");
const { getConfig, getSiteType, SITE_TYPES, createBatches } = require("../utils");
const { getRuntimeConfig } = require("../lib/runtimeConfig");
const { handleActionError } = require("../lib/errorHandler");
const { Timings } = require("../lib/benchmark");
const { AdminAPI } = require("../lib/aem");
const {
  getCategoryDetailsFromFamilies,
  hasFamilies,
} = require("../categories");
const { renderCategoryPage } = require("./render");

const CONCURRENCY = 5;

/**
 * App Builder action entry point. Discovers all ACO category families,
 * fetches full category details, and renders an HTML page for each one
 * containing title, meta description, H1, H2 sections, breadcrumbs,
 * ItemList JSON-LD, and BreadcrumbList JSON-LD.
 *
 * @param {Object} params - App Builder action parameters.
 * @returns {Promise<Object>} Action response with rendered category pages.
 */
async function main(params) {
  try {
    const cfg = getRuntimeConfig(params);
    const logger = Core.Logger("main", { level: cfg.logLevel });
    const context = { ...cfg, logger };
    const timings = new Timings();

    const siteConfig = await getConfig(context);
    const siteType = getSiteType(siteConfig);

    if (siteType !== SITE_TYPES.ACO) {
      return {
        statusCode: 400,
        body: {
          error: "render-all-categories is only supported for ACO sites",
        },
      };
    }

    if (!hasFamilies(cfg.categoryFamilies)) {
      return {
        statusCode: 400,
        body: { error: "No ACO_CATEGORY_FAMILIES configured" },
      };
    }

    const categoriesMap = await getCategoryDetailsFromFamilies(
      context,
      cfg.categoryFamilies,
    );
    timings.sample("fetchCategories");

    const pLimitMod = await import("p-limit");
    const limit = pLimitMod.default(CONCURRENCY);

    const slugs = [...categoriesMap.keys()];
    const results = await Promise.all(
      slugs.map((slug) =>
        limit(async () => {
          const category = categoriesMap.get(slug);
          try {
            const html = await renderCategoryPage(
              category,
              categoriesMap,
              context,
            );
            return { slug, html };
          } catch (err) {
            logger.error(`Failed to render category ${slug}:`, err);
            return { slug, error: err.message };
          }
        }),
      ),
    );
    const rendered = results.filter((r) => r.html);
    const failed = results.filter((r) => r.error);
    timings.sample("renderCategories");

    logger.info(
      `Rendered ${rendered.length} categories, ${failed.length} failed`,
    );

    const publishCounts = { previewed: 0, published: 0, failed: 0 };

    if (rendered.length > 0 && cfg.adminAuthToken && cfg.org && cfg.site) {
      let filesLib;
      try {
        const { Files } = require("@adobe/aio-sdk");
        filesLib = await Files.init();
        logger.info("Files SDK initialized");
      } catch (e) {
        logger.error(`Files SDK init failed: ${e.message}`);
      }

      if (filesLib) {
        try {
          await Promise.all(
            rendered.map(async ({ slug, html }) => {
              const htmlPath = `/public/pdps/${slug}.html`;
              await filesLib.write(htmlPath, html);
              logger.info(`Wrote overlay: ${htmlPath}`);
            }),
          );
          timings.sample("writeOverlay");
        } catch (e) {
          logger.error(`Overlay write failed: ${e.message}`);
        }
      } else {
        logger.info("Skipping overlay write, Files SDK unavailable");
      }

      const adminApi = new AdminAPI(
        { org: cfg.org, site: cfg.site },
        { ...context },
        { authToken: cfg.adminAuthToken },
      );

      await adminApi.startProcessing();

      try {
        const records = rendered.map(({ slug }) => ({
          slug,
          path: `/${slug}`,
        }));
        const batches = createBatches(records);

        await Promise.all(
          batches.map((batch, batchNumber) => {
            const batchRecords = batch.map(({ slug, path }) => ({
              slug,
              path,
            }));
            return adminApi
              .previewAndPublish(batchRecords, null, batchNumber + 1)
              .then(({ records: publishedRecords }) => {
                for (const record of publishedRecords) {
                  if (record.previewedAt) publishCounts.previewed++;
                  if (record.publishedAt) publishCounts.published++;
                  if (!record.previewedAt && !record.publishedAt)
                    publishCounts.failed++;
                }
              })
              .catch((err) => {
                logger.error(
                  `Failed to publish batch ${batchNumber + 1}:`,
                  err,
                );
                publishCounts.failed += batch.length;
              });
          }),
        );
      } finally {
        await adminApi.stopProcessing();
      }

      timings.sample("publishCategories");
    } else {
      logger.info(
        "Skipping publish: missing adminAuthToken, org, or site configuration",
      );
    }

    return {
      statusCode: 200,
      body: {
        status: "completed",
        categoriesRendered: rendered.length,
        categoriesFailed: failed.length,
        categoriesPublished: publishCounts.published,
        categoriesPublishFailed: publishCounts.failed,
        timings: timings.measures,
        categories: rendered,
        ...(failed.length > 0 && { errors: failed }),
      },
    };
  } catch (error) {
    const logger = Core.Logger("main", { level: "error" });
    return handleActionError(error, {
      logger,
      actionName: "Render all categories",
    });
  }
}

exports.main = main;
