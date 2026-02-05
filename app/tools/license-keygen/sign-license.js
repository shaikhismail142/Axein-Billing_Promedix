#!/usr/bin/env node
// Node 16+ (CommonJS). Signs the canonical string:
//   <license_key>\n<email>\n<expires_at>
// and outputs the JSON body your API expects.
//
// Usage:
//   node tools/license-keygen/sign-license.js \
//     --key tools/license-keygen/ed25519-private.pem \
//     --license AXEIN-AB12-CD34-EF56 \
//     --email you@example.com \
//     --expires 2030-12-31T23:59:59Z > signed.json

const fs = require('fs');
const crypto = require('crypto');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : def;
}

const keyPath = arg('--key');
const license = arg('--license');
const email = arg('--email');
const expires = arg('--expires');

if (!keyPath || !license || !email || !expires) {
  console.error('Missing args.\nExample:\n  node tools/license-keygen/sign-license.js \\');
  console.error('    --key tools/license-keygen/ed25519-private.pem \\');
  console.error('    --license AXEIN-AB12-CD34-EF56 \\');
  console.error('    --email you@example.com \\');
  console.error('    --expires 2030-12-31T23:59:59Z > signed.json');
  process.exit(1);
}

const privPem = fs.readFileSync(keyPath, 'utf8');
const canonical = `${license}\n${email}\n${expires}`;

const sig = crypto.sign(null, Buffer.from(canonical, 'utf8'), privPem); // Ed25519 raw
const signatureB64 = Buffer.from(sig).toString('base64');

const payload = {
  license_key: license,
  email,
  expires_at: expires,
  signature: signatureB64,
};

console.log(JSON.stringify(payload, null, 2));
