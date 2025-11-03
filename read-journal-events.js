#!/usr/bin/env node

/**
 * Simple script to read events from Adobe I/O Events Journal
 * 
 * Usage:
 *   node read-journal-events.js [limit]
 */

require('dotenv').config();
const { Events, State } = require('@adobe/aio-sdk');
const { StateManager } = require('./actions/lib/state');
const { TokenManager } = require('./actions/events-handler/token-manager');

async function readJournalEvents() {
  console.log('📖 Reading events from Adobe I/O Events Journal...\n');
  
  const limit = parseInt(process.argv[2] || '10', 10);
  
  try {
    // Initialize State for token management
    const stateLib = await State.init({
      ow: {
        namespace: process.env.AIO_runtime_namespace,
        auth: process.env.AIO_runtime_auth
      }
    });
    const stateManager = new StateManager(stateLib, { logger: console });
    
    // Initialize TokenManager
    const tokenManager = new TokenManager({
      CLIENT_ID: process.env.CLIENT_ID,
      CLIENT_SECRET: process.env.CLIENT_SECRET,
      IMS_ORG_ID: process.env.IMS_ORG_ID
    }, stateManager, console);
    
    console.log('🔑 Getting access token...');
    const accessToken = await tokenManager.getAccessToken();
    console.log('✅ Access token obtained\n');
    
    // Initialize Events client
    const eventsClient = await Events.init(
      process.env.IMS_ORG_ID,
      process.env.CLIENT_ID,
      accessToken
    );
    
    console.log(`📥 Fetching up to ${limit} events from journal...`);
    console.log(`   Journal URL: ${process.env.JOURNALLING_URL}\n`);
    
    // Get last position from state
    const lastPosition = await stateManager.get('events_position');
    
    if (lastPosition) {
      console.log(`📍 Last saved position: ${lastPosition.substring(0, 50)}...\n`);
    } else {
      console.log('📍 No saved position, starting from beginning\n');
    }
    
    // Fetch events
    const options = { limit };
    if (lastPosition && lastPosition !== 'END' && lastPosition !== 'BEGINNING') {
      options.since = lastPosition;
    }
    
    const result = await eventsClient.getEventsFromJournal(
      process.env.JOURNALLING_URL,
      options
    );
    
    const events = result.events || [];
    
    console.log('='.repeat(80));
    console.log(`📊 EVENTS SUMMARY`);
    console.log('='.repeat(80));
    console.log(`Total events fetched: ${events.length}`);
    console.log('');
    
    if (events.length === 0) {
      console.log('No new events in journal.');
      return;
    }
    
    // Display each event
    events.forEach((event, index) => {
      console.log(`\n${'─'.repeat(80)}`);
      console.log(`EVENT #${index + 1}`);
      console.log('─'.repeat(80));
      
      console.log(`Position: ${event.position}`);
      console.log(`Event ID: ${event.event?.id || 'N/A'}`);
      console.log(`Event Type: ${event.event?.['@type'] || 'N/A'}`);
      console.log(`Created: ${event.event?.['activitystreams:published'] || 'N/A'}`);
      
      // Extract SKU if present
      const sku = event.event?.data?.sku;
      if (sku) {
        console.log(`SKU: ${sku}`);
      }
      
      // Show event data
      if (event.event?.data) {
        console.log('\nEvent Data:');
        console.log(JSON.stringify(event.event.data, null, 2));
      }
      
      // Show full event (optional - commented out by default)
      // console.log('\nFull Event:');
      // console.log(JSON.stringify(event, null, 2));
    });
    
    console.log('\n' + '='.repeat(80));
    
    // Extract unique SKUs
    const skus = new Set();
    events.forEach(event => {
      const sku = event.event?.data?.sku;
      if (sku) skus.add(sku);
    });
    
    if (skus.size > 0) {
      console.log(`\n📦 Unique SKUs found: ${skus.size}`);
      console.log(Array.from(skus).map(sku => `   - ${sku}`).join('\n'));
    }
    
    // Show new position
    if (events.length > 0) {
      const newPosition = events[events.length - 1].position;
      console.log(`\n📍 New position: ${newPosition.substring(0, 50)}...`);
    }
    
    console.log('\n' + '='.repeat(80));
    
  } catch (error) {
    console.error('\n❌ Error reading journal:', error.message);
    console.error('\nFull error:');
    console.error(error);
    process.exit(1);
  }
}

// Run
readJournalEvents();

