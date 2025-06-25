#!/usr/bin/env node

import { AutoRouter } from 'itty-router'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createServerAdapter } from '@whatwg-node/server'
import { createServer } from 'http'
import { exec } from 'child_process'
import { promisify } from 'util'

import { Files, State } from '@adobe/aio-sdk';
import runtimeLib from '@adobe/aio-lib-runtime';
import { createPatch } from 'diff';
import yaml from 'js-yaml';
import fs from 'fs';
import dotenvStringify from 'dotenv-stringify';
import dotenv from 'dotenv';

const execAsync = promisify(exec);

// Configuration and Constants
const RULES_MAP = {
    'productScraperRule': {
      name: 'Refresh Product SKU List',
      description: 'Download the list product SKU from Catalog Service every 60 minutes',
    },
    'productPollerRule': {
      name: 'Check for Product Changes',
      description: 'Triggers a check for products that have been updated, created or deleted in the Catalog. This is triggered every minute. If execution lasts more than 1 minute, there won\'t be any concurrency.',
    }
  }
  
  const CONTENT_TYPES = {
    '.js': 'application/javascript',
    '.html': 'text/html',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml'
  }
  
  // Utility Classes
  class AuthService {
    static async verifyJWT(token) {
      try {
        const response = await fetch('https://admin.hlx.page/auth/discovery/keys');
        const { publicKey } = await response.json();
        const [headerB64, payloadB64, signatureB64] = token.split('.');
        const header = JSON.parse(atob(headerB64));
        const payload = JSON.parse(atob(payloadB64));
  
        console.log('Token Header:', header);
        console.log('Token Payload:', payload);
  
        return { isValid: true, header, payload };
      } catch (error) {
        console.error('Token verification failed:', error);
        return { isValid: false, error: error.message };
      }
    }
  }
  
  class ConfigService {
    static async buildAppConfig(params) {
      const { org, site, locales, contentUrl, productsTemplate, productPageUrlFormat, storeUrl } = params;
      
      try {
        const sampleConfigContent = fs.readFileSync('app.config.yaml', 'utf8');
        const currentConfig = yaml.load(sampleConfigContent);
        const { inputs } = currentConfig.application.runtimeManifest.packages['aem-commerce-ssg'];
  
        Object.assign(inputs, {
          ORG: org,
          SITE: site,
          CONTENT_URL: contentUrl,
          PRODUCTS_TEMPLATE: productsTemplate,
          PRODUCT_PAGE_URL_FORMAT: productPageUrlFormat,
          STORE_URL: storeUrl,
          LOCALES: locales
        });
  
        return {
          newConfig: yaml.dump(currentConfig, { indent: 2, quotingType: '"', forceQuotes: true }),
          currentConfig: sampleConfigContent
        };
      } catch (error) {
        console.error('Error reading app.config.yaml:', error);
        throw new Error('Failed to read app.config.yaml. Make sure the file exists in the current directory.');
      }
    }
  
    static async buildIndexConfig(currentYamlConfig) {
      const sampleConfigRequest = await fetch(
        'https://raw.githubusercontent.com/adobe-rnd/aem-commerce-prerender/refs/heads/main/query.yaml'
      );
      const sampleIndexConfigContent = await sampleConfigRequest.text();
      const existingIndexConfig = currentYamlConfig ? yaml.load(currentYamlConfig) : {};
      const newConfig = yaml.load(sampleIndexConfigContent);
  
      const mergedConfig = {
        ...existingIndexConfig,
        indices: {
          ...existingIndexConfig.indices,
          'index-published-products': newConfig['indices']['index-published-products']
        }
      };
  
      return yaml.dump(mergedConfig, { indent: 2 });
    }
  }
  
  class FileService {
    static async getOverlayBaseURL(filesBase) {
      const testFileName = '/test-dir';
      const testFileContent = Buffer.from('This is a mock file');
      await filesBase.write(testFileName, testFileContent);
  
      const fileProperties = await filesBase.getProperties(testFileName);
      const url = fileProperties.url;
      const baseUrl = url.match(/(https:\/\/[^"'\s]+?)\/[^/]+$/)?.[1] || null;
      
      if (!baseUrl) {
        throw new Error('Failed to extract base URL');
      }
  
      await filesBase.delete(testFileName);
      return `${baseUrl}-public/public/pdps`;
    }
  
    static async deleteFiles(filesBase, foldersToEmpty) {
      let totalFilesCount = 0;
      
      for (const folder of foldersToEmpty) {
        const folderFiles = await filesBase.list(`${folder}/`);
        for (let i = 0; i < folderFiles.length; i += 5) {
          const batch = folderFiles.slice(i, i + 5);
          await Promise.all(batch.map(file => filesBase.delete(file.name)));
          totalFilesCount += batch.length;
        }
      }
      
      return totalFilesCount;
    }
  }
  
  class StaticFileServer {
    static serve(path) {
      try {
        const normalizedPath = path.replace(/^\//, '').replace(/^ui\//, '');
        const filePath = join(import.meta.url.replace('file://', ''), '..', 'ui', normalizedPath);
        console.log("serving file", filePath);
        const content = readFileSync(filePath);
        const extension = path.substring(path.lastIndexOf('.'));
        const contentType = CONTENT_TYPES[extension] || 'text/plain';
  
        return new Response(content, {
          headers: { 'Content-Type': contentType }
        });
      } catch (error) {
        console.log("error", error);
        if (error.code === 'EISDIR') {
          return StaticFileServer.serve(join(path, 'index.html'));
        }
        return new Response('Not Found', { status: 404 });
      }
    }
  }
  
  class RequestHelper {
    static extractHeaders(request) {
      const headers = request.headers;
      return {
        namespace: headers.get('X-AIO-namespace'),
        auth: headers.get('X-AIO-auth'),
        aemAdminToken: headers.get('X-AEM-admin-token')
      };
    }
  
    static async initServices(headers) {
      const { namespace, auth } = headers;
      return {
        filesBase: await Files.init({ ow: { namespace, auth } }),
        runtimeBase: await runtimeLib.init({ namespace, api_key: auth, apihost: 'https://adobeioruntime.net' }),
        stateBase: await State.init({ ow: { namespace, auth } })
      };
    }
  
    static jsonResponse(data, status = 200, extraHeaders = {}) {
      return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...extraHeaders }
      });
    }
  
    static errorResponse(message, status = 400) {
      return RequestHelper.jsonResponse({ error: message }, status);
    }
  }
  
  // Route Handlers
  class ApiRoutes {
    static async wizardDone(request) {
        console.log("Wizard completed, shutting down server.");
        setTimeout(() => process.exit(0), 1000); // Delay to allow response to be sent
        return RequestHelper.jsonResponse({ message: 'Server is shutting down.' });
    }

    static async handleExternalSubmission(request) {
        try {
            const formData = await request.formData();
            const jsonData = formData.get('data');
            
            if (!jsonData) {
                return RequestHelper.errorResponse('No data field found in form submission');
            }

            const parsedData = JSON.parse(jsonData);
            
            console.log('Received external submission:');
            console.log('ID:', parsedData.id);
            console.log('Org:', parsedData.org);
            console.log('Site:', parsedData.site);
            console.log('Namespace:', parsedData.appbuilderProjectJSON?.project?.workspace?.details?.runtime?.namespaces?.[0]?.name);
            console.log('AEM Admin JWT:', parsedData.aemAdminJWT ? 'Present' : 'Missing');
            
            // Here you could process the data further, save to database, etc.
            // For now, we'll just log it and return success
            
            return RequestHelper.jsonResponse({
                success: true,
                message: 'Configuration received successfully',
                data: {
                    id: parsedData.id,
                    org: parsedData.org,
                    site: parsedData.site,
                    namespace: parsedData.appbuilderProjectJSON?.project?.workspace?.details?.runtime?.namespaces?.[0]?.name
                }
            });
            
        } catch (error) {
            console.error('Error processing external submission:', error);
            return RequestHelper.errorResponse('Failed to process submission: ' + error.message, 500);
        }
    }

    static async getFiles(request) {
      const headers = RequestHelper.extractHeaders(request);
      const { filesBase } = await RequestHelper.initServices(headers);
      const files = await filesBase.list('/');
      return RequestHelper.jsonResponse({ files });
    }
  
    static async changeDetectorRule(request) {
      const headers = RequestHelper.extractHeaders(request);
      const { runtimeBase } = await RequestHelper.initServices(headers);
      const { ruleName, active } = await request.json();
  
      console.log(`Setting rule ${ruleName} to ${active ? 'active' : 'inactive'}`);
  
      if (active) {
        await runtimeBase.rules.enable({ name: ruleName });
      } else {
        await runtimeBase.rules.disable({ name: ruleName });
      }
  
      return RequestHelper.jsonResponse({
        message: `Rule ${ruleName} ${active ? 'enabled' : 'disabled'}`
      });
    }
  
    static async setup(request) {
      const headers = RequestHelper.extractHeaders(request);
      const jwtBody = await AuthService.verifyJWT(headers.aemAdminToken);
      
      if (!jwtBody.isValid) {
        return RequestHelper.errorResponse('Invalid token', 401);
      }
  
      const { filesBase } = await RequestHelper.initServices(headers);
      const { sub } = jwtBody.payload;
      const [org, site] = sub.split('/');
  
      const reqBody = await request.json();
      const { productPageUrlFormat, contentUrl, productsTemplate, storeUrl, org: userInputOrg, site: userInputSite } = reqBody;
      let { locales } = reqBody;
  
      if (locales?.trim() === '') locales = null;
  
      if (!contentUrl || !productsTemplate || !productPageUrlFormat || !userInputOrg || !userInputSite || !storeUrl) {
        return RequestHelper.errorResponse('Missing required parameters. Please provide: locales, contentUrl, productsTemplate, productPageUrlFormat, org, site, and storeUrl');
      }
  
      const siteConfigEndpoint = `https://admin.hlx.page/config/${org}/sites/${site}.json`;
      console.log(`Fetching site config from ${siteConfigEndpoint}`);
  
      const [siteConfigResponse, indexConfigResponse] = await Promise.all([
        fetch(siteConfigEndpoint, {
          method: 'GET',
          headers: { 'x-auth-token': headers.aemAdminToken }
        }),
        fetch(`https://admin.hlx.page/config/${org}/sites/${site}/content/query.yaml`, {
          method: 'GET',
          headers: { 'x-auth-token': headers.aemAdminToken }
        })
      ]);
  
      const [currentSiteConfig, currentIndexConfig] = await Promise.all([
        siteConfigResponse.json(),
        indexConfigResponse.text()
      ]);
  
      console.log(`Fetched site config from ${siteConfigEndpoint}`);
  
      const overlayBaseURL = await FileService.getOverlayBaseURL(filesBase);
      const newSiteConfig = {
        ...currentSiteConfig,
        content: {
          ...currentSiteConfig.content,
          overlay: { url: overlayBaseURL, type: 'markup', suffix: '.html' }
        }
      };
  
      const [newIndexConfig, { newConfig: newAppConfig, currentConfig: currentAppConfig }] = await Promise.all([
        ConfigService.buildIndexConfig(currentIndexConfig),
        ConfigService.buildAppConfig({ org: userInputOrg, site: userInputSite, locales, contentUrl, productsTemplate, productPageUrlFormat, storeUrl })
      ]);
  
      console.log("fetched all configs");
  
      const patches = [
        createPatch("site-config.json.patch", JSON.stringify(currentSiteConfig, null, 2), JSON.stringify(newSiteConfig, null, 2)),
        createPatch("index-config.yaml.patch", currentIndexConfig, newIndexConfig),
        createPatch("app-config.yaml.patch", currentAppConfig, newAppConfig)
      ];
  
      return RequestHelper.jsonResponse({
        currentSiteConfig,
        newSiteConfig,
        currentIndexConfig,
        newIndexConfig,
        newAppConfig,
        patch: patches.join('\n')
      });
    }
  
    static async deleteChangeDetectorState(request) {
      const headers = RequestHelper.extractHeaders(request);
      const { filesBase } = await RequestHelper.initServices(headers);
      const foldersToEmpty = ['check-product-changes', 'public'];
  
      try {
        const totalFilesCount = await FileService.deleteFiles(filesBase, foldersToEmpty);
        console.log(`All files deleted successfully. Total files deleted: ${totalFilesCount}`);
        return RequestHelper.jsonResponse({ message: 'Files deleted successfully.', totalFilesCount });
      } catch (error) {
        return RequestHelper.jsonResponse({ message: 'Error deleting files.', error: error.message }, 500);
      }
    }
  
    static async productScraperScrape(request) {
      const headers = RequestHelper.extractHeaders(request);
      const jwtBody = await AuthService.verifyJWT(headers.aemAdminToken);
      
      if (!jwtBody.isValid) {
        return RequestHelper.errorResponse('Invalid token', 401);
      }
  
      const { runtimeBase } = await RequestHelper.initServices(headers);
      const { contentUrl, configName } = await request.json();
      
      if (!contentUrl || !configName) {
        return RequestHelper.errorResponse('contentUrl and configName are required');
      }
  
      const { sub } = jwtBody.payload;
      const [org, site] = sub.split('/');
  
      const result = await runtimeBase.actions.invoke({
        blocking: true,
        result: true,
        name: 'aem-commerce-ssg/fetch-all-products',
      });
  
      return RequestHelper.jsonResponse({ message: 'Action invoked successfully.', result });
    }

    static async aioConfig(request) {
      const headers = RequestHelper.extractHeaders(request);
      const { aioNamespace, aioAuth, fileContent, fileName } = await request.json();

      const newFileName = fileName.replace(/\.json$/, '.aio.json');
      
      try {
        // Save the configuration file
        await fs.writeFileSync(newFileName, fileContent);
        
        // Execute aio app use command
        console.log(`Executing: aio app use "${newFileName}"`);
        const { stdout, stderr } = await execAsync(`aio app use "${newFileName}" --no-input`, {
          cwd: process.cwd(),
          timeout: 30000,
          stdio: 'pipe'
        });
        
        if (stdout) {
          console.log('AIO app use output:', stdout);
        }
        if (stderr) {
          console.log('AIO app use warnings:', stderr);
        }
        
        console.log('Successfully executed aio app use command.');
        
        return RequestHelper.jsonResponse({ 
          success: true,
          message: 'AIO configuration saved and applied successfully.',
          output: stdout,
          warnings: stderr
        });
        
      } catch (error) {
        console.error('Failed to execute aio app use command:', error.message);
        
        return RequestHelper.jsonResponse({ 
          success: false,
          message: 'AIO configuration saved but failed to apply.',
          error: error.message,
          stdout: error.stdout,
          stderr: error.stderr
        }, 500);
      }
    }

    static async getRules(request) {
      const headers = RequestHelper.extractHeaders(request);
      const { runtimeBase } = await RequestHelper.initServices(headers);
      const rules = await runtimeBase.rules.list();
      return RequestHelper.jsonResponse({ rules });
    }

    static async helixConfig(request) {
      const headers = RequestHelper.extractHeaders(request);
      const jwtBody = await AuthService.verifyJWT(headers.aemAdminToken);
      
      if (!jwtBody.isValid) {
        return RequestHelper.errorResponse('Invalid token', 401);
      }

      const { newIndexConfig, newSiteConfig, appConfigParams, aioNamespace, aioAuth } = await request.json();
      if (!newIndexConfig || !newSiteConfig || !appConfigParams) {
        return RequestHelper.errorResponse('newIndexConfig, newSiteConfig, and appConfigParams are required');
      }

      const { sub } = jwtBody.payload;
      const [org, site] = sub.split('/');

      // Generate and write app.config.yaml locally
      try {
        const { newConfig: newAppConfig } = await ConfigService.buildAppConfig(appConfigParams);
        fs.writeFileSync('app.config.yaml', newAppConfig);
        console.log('Successfully wrote app.config.yaml to local filesystem');

        const contextInfo = {
            ...appConfigParams,
            aioNamespace,
            aioAuth
        };
        fs.writeFileSync('.aem-commerce-prerender.json', JSON.stringify(contextInfo, null, 2));
        console.log('Successfully wrote .aem-commerce-prerender.json to local filesystem');

        // Add/update AEM_ADMIN_API_AUTH_TOKEN in .env file using dotenv and dotenv-stringify
        const envPath = '.env';
        let envObject = {};
        if (fs.existsSync(envPath)) {
            const envContent = fs.readFileSync(envPath, 'utf8');
            envObject = dotenv.parse(envContent);
        }

        envObject['AEM_ADMIN_API_AUTH_TOKEN'] = headers.aemAdminToken;

        const newEnvContent = dotenvStringify(envObject);
        fs.writeFileSync(envPath, newEnvContent);
        console.log('Successfully updated .env file with AEM_ADMIN_API_AUTH_TOKEN.');

      } catch (error) {
        console.error('Failed to write configuration files:', error);
        return RequestHelper.errorResponse('Failed to write configuration files: ' + error.message, 500);
      }

      const [siteConfigApplyResponse, indexConfigApplyResponse] = await Promise.all([
        fetch(`https://admin.hlx.page/config/${org}/sites/${site}.json`, {
          method: 'POST',
          headers: { 'x-auth-token': headers.aemAdminToken, 'Content-Type': 'application/json' },
          body: JSON.stringify(newSiteConfig)
        }),
        fetch(`https://admin.hlx.page/config/${org}/sites/${site}/content/query.yaml`, {
          method: 'POST',
          headers: { 'x-auth-token': headers.aemAdminToken, 'Content-Type': 'text/yaml' },
          body: newIndexConfig
        })
      ]);

      const [siteConfigApplyResult, indexConfigApplyResult] = await Promise.all([
        siteConfigApplyResponse.json(),
        indexConfigApplyResponse.text()
      ]);

      if (!siteConfigApplyResponse.ok || !indexConfigApplyResponse.ok) {
        const errors = [];
        if (!siteConfigApplyResponse.ok) {
          errors.push(`Site config update failed: ${siteConfigApplyResponse.status} ${siteConfigApplyResponse.statusText}`);
        }
        if (!indexConfigApplyResponse.ok) {
          errors.push(`Index config update failed: ${indexConfigApplyResponse.status} ${indexConfigApplyResponse.statusText}`);
        }
        return RequestHelper.jsonResponse({ error: 'Config update failed' }, 500, { 'X-Error': errors.join('; ') });
      }

      return RequestHelper.jsonResponse({
        message: 'Config updated successfully and app.config.yaml written to local filesystem',
        siteConfigApplyResult,
        indexConfigApplyResult
      });
    }
  
    static async getChangeDetector(request) {
      const headers = RequestHelper.extractHeaders(request);
      const { runtimeBase, stateBase } = await RequestHelper.initServices(headers);
  
      const [lastActivations, rulesList] = await Promise.all([
        runtimeBase.activations.list().then(activations => 
          activations.filter(activation => activation.name === 'check-product-changes')
        ),
        runtimeBase.rules.list()
      ]);
  
      const rules = await Promise.all(rulesList.map(async rule => {
        if (RULES_MAP[rule.name]) {
          const ruleDetails = await runtimeBase.rules.get(rule.name);
          return {
            namespace: rule.namespace,
            id: rule.name,
            name: RULES_MAP[rule.name].name,
            description: RULES_MAP[rule.name].description,
            updated: rule.updated,
            active: ruleDetails?.status === 'active'
          };
        }
      }));
  
      return RequestHelper.jsonResponse({
        running: stateBase.get('running') === 'true',
        lastActivation: lastActivations[0],
        lastActivationTimestamp: lastActivations[0]?.start,
        rules: rules.filter(Boolean)
      });
    }
  }

// Server Setup
class Server {
    constructor() {
      this.router = AutoRouter();
      this.setupRoutes();
    }
  
    setupRoutes() {
      this.router
        .get('/', () => StaticFileServer.serve('index.html'))
        .get('/api/files', ApiRoutes.getFiles)
        .get('/api/rules', ApiRoutes.getRules)
        .post('/api/aio-config', ApiRoutes.aioConfig)
        .post('/api/external-submit', ApiRoutes.handleExternalSubmission)
        .post('/api/change-detector/rule', ApiRoutes.changeDetectorRule)
        .post('/api/wizard/done', ApiRoutes.wizardDone)
        .post('/api/setup', ApiRoutes.setup)
        .delete('/api/change-detector/state', ApiRoutes.deleteChangeDetectorState)
        .post('/api/product-scraper/scrape', ApiRoutes.productScraperScrape)
        .post('/api/helix-config', ApiRoutes.helixConfig)
        .get('/api/change-detector', ApiRoutes.getChangeDetector)
        .get('/*', (request) => {
          const path = request.url.split('/').pop();
          return StaticFileServer.serve(path);
        });
    }
  
      start(port = 3030) {
    const ittyServer = createServerAdapter(this.router.fetch);
    const httpServer = createServer(ittyServer);
    httpServer.listen(port);
    console.log(`Server running on port ${port}`);
    openBrowser(`http://localhost:${port}`);
  }
  }
  
// Utility function to open browser cross-platform
function openBrowser(url) {
  const platform = process.platform;
  let command;

  switch (platform) {
    case 'win32':
      command = `start ${url}`;
      break;
    case 'darwin':
      command = `open ${url}`;
      break;
    case 'linux':
      command = `xdg-open ${url}`;
      break;
    default:
      console.log(`Please open your browser manually and navigate to: ${url}`);
      return;
  }

  exec(command, (error) => {
    if (error) {
      console.log(`Could not open browser automatically. Please open your browser manually and navigate to: ${url}`);
    }
  });
}

// Main function
async function main() {
  console.log('Starting AEM Commerce Prerender Setup Wizard...');
  
  // Start the server directly
  new Server().start(3030);
}

// Run the main function
main().catch(error => {
  console.error('Error starting setup:', error);
  process.exit(1);
});