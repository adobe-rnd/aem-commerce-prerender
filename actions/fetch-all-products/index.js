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

const { Core, Files } = require("@adobe/aio-sdk");
const { getConfig, getSiteType, SITE_TYPES, FILE_PREFIX } = require("../utils");
const { Timings } = require("../lib/benchmark");
const { getRuntimeConfig } = require("../lib/runtimeConfig");
const { handleActionError } = require("../lib/errorHandler");
const { getAllSkus: getAllSkusAccs } = require("./accs");
const { getAllSkus: getAllSkusAco } = require("./aco");

async function main(params) {
  try {
    // Resolve runtime config
    const cfg = getRuntimeConfig(params);
    const logger = Core.Logger("main", { level: cfg.logLevel });

    const sharedContext = { ...cfg, logger };

    const results = await Promise.all(
      cfg.locales.map(async (locale) => {
        const context = { ...sharedContext };
        if (locale) {
          context.locale = locale;
        }
        const timings = new Timings();
        const stateFilePrefix = locale || "default";

        const siteConfig = await getConfig(context);
        const siteType = getSiteType(siteConfig);
        const allSkus =
          siteType === SITE_TYPES.ACO
            ? await getAllSkusAco(context)
            : await getAllSkusAccs(context);

        timings.sample("getAllSkus");
        const filesLib = await Files.init(params.libInit || {});
        timings.sample("saveFile");
        const productsFileName = `${FILE_PREFIX}/${stateFilePrefix}-products.json`;
        await filesLib.write(productsFileName, JSON.stringify(allSkus));
        return timings.measures;
      }),
    );

    return {
      statusCode: 200,
      body: { status: "completed", timings: results },
    };
  } catch (error) {
    // Handle errors and determine if job should fail
    const logger = Core.Logger("main", { level: "error" });

    return handleActionError(error, {
      logger,
      actionName: "Fetch all products",
    });
  }
}

exports.main = main;
