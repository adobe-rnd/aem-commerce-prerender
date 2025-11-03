#!/usr/bin/env node

/**
 * Test script for simplified events-handler
 * 
 * Usage:
 *   node test-events-handler-simple.js
 */

require('dotenv').config();
const { main } = require('./actions/events-handler/index');

async function runTest() {
  console.log('Testing simplified events-handler...\n');
  
  // Prepare test parameters from environment
  const params = {
    // Adobe I/O credentials
    IMS_ORG_ID: process.env.IMS_ORG_ID,
    CLIENT_ID: process.env.CLIENT_ID,
    CLIENT_SECRET: process.env.CLIENT_SECRET,
    JOURNALLING_URL: process.env.JOURNALLING_URL,
    
    // AEM configuration
    ORG: process.env.ORG,
    SITE: process.env.SITE,
    AEM_ADMIN_API_AUTH_TOKEN: process.env.AEM_ADMIN_API_AUTH_TOKEN,
    
    // Content URLs
    CONTENT_URL: process.env.CONTENT_URL,
    STORE_URL: process.env.STORE_URL,
    PRODUCTS_TEMPLATE: process.env.PRODUCTS_TEMPLATE,
    PRODUCT_PAGE_URL_FORMAT: process.env.PRODUCT_PAGE_URL_FORMAT,
    
    // Optional configuration
    LOG_LEVEL: 'info',
    db_event_key: 'test_events_position',
    
    // LibInit from environment for Adobe I/O Runtime access
    libInit: process.env.AIO_runtime_namespace ? {
      ow: {
        namespace: process.env.AIO_runtime_namespace,
        auth: process.env.AIO_runtime_auth
      }
    } : undefined
  };
  
  // Validate required parameters
  const required = [
    'IMS_ORG_ID',
    'CLIENT_ID', 
    'CLIENT_SECRET',
    'JOURNALLING_URL',
    'ORG',
    'SITE'
  ];
  
  const missing = required.filter(key => !params[key]);
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach(key => console.error(`   - ${key}`));
    console.error('\nPlease set these in your .env file');
    process.exit(1);
  }
  
  console.log('Configuration:');
  console.log(`  ORG: ${params.ORG}`);
  console.log(`  SITE: ${params.SITE}`);
  console.log(`  JOURNALLING_URL: ${params.JOURNALLING_URL}`);
  console.log(`  Events position key: ${params.db_event_key}`);
  console.log('');
  
  try {
    const startTime = Date.now();
    
    console.log('Running events-handler...\n');
    const result = await main(params);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log('\n' + '='.repeat(60));
    console.log('RESULT:');
    console.log('='.repeat(60));
    console.log(JSON.stringify(result, null, 2));
    console.log('='.repeat(60));
    console.log(`\nCompleted in ${duration}s`);
    
    if (result.status === 'error') {
      console.error('\n❌ Events handler failed!');
      process.exit(1);
    } else {
      console.log('\n✅ Events handler completed successfully!');
      
      const stats = result.statistics;
      console.log('\nStatistics:');
      console.log(`  Events fetched: ${stats.events_fetched}`);
      console.log(`  Unique SKUs: ${stats.unique_skus}`);
      console.log(`  Processed: ${stats.processed}`);
      console.log(`  Failed: ${stats.failed}`);
      console.log(`  Published: ${stats.published}`);
    }
    
  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
    console.error('\nStack trace:');
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
runTest();

