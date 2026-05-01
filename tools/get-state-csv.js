// Downloads all CSVs from App Builder Files storage for check-product-changes.
// Run: node get-state-csv.js
require('dotenv').config();
const { Files } = require('@adobe/aio-sdk');
const fs = require('fs');

async function main() {
  const ow = {
    namespace: process.env.AIO_runtime_namespace,
    auth: process.env.AIO_runtime_auth,
  };
  const filesLib = await Files.init({ ow });

  const files = await filesLib.list('check-product-changes/');
  if (!files.length) {
    console.log('No files found under check-product-changes/');
    return;
  }

  console.log(`Found ${files.length} file(s):`);
  for (const file of files) {
    const buf = await filesLib.read(file.name);
    const localName = file.name.replace('/', '-');
    fs.writeFileSync(localName, buf);
    console.log(`  Saved: ${localName}`);
  }
}

main().catch(console.error);
