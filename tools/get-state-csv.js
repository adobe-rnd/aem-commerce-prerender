// Downloads state files (csv/json) from App Builder Files storage.
// Run: node get-state-csv.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Files } = require('@adobe/aio-sdk');
const fs = require('fs');

const PREFIXES = ['check-product-changes', 'render-all-categories'];
const LOCAL_DATA_DIR = path.resolve(__dirname, '../local-data');

async function downloadPrefix(filesLib, prefix) {
  const files = await filesLib.list(`${prefix}/`);
  if (!files.length) {
    console.log(`No files found under ${prefix}/`);
    return;
  }

  const outDir = path.join(LOCAL_DATA_DIR, prefix);
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`Found ${files.length} file(s) under ${prefix}/:`);
  for (const file of files) {
    const buf = await filesLib.read(file.name);
    const localName = path.join(outDir, path.basename(file.name));
    fs.writeFileSync(localName, buf);
    console.log(`  Saved: ${localName}`);
  }
}

async function main() {
  const ow = {
    namespace: process.env.AIO_runtime_namespace,
    auth: process.env.AIO_runtime_auth,
  };
  const filesLib = await Files.init({ ow });

  for (const prefix of PREFIXES) {
    await downloadPrefix(filesLib, prefix);
  }
}

main().catch(console.error);
