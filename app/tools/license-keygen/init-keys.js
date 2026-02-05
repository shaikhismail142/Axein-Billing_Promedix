#!/usr/bin/env node
// Node 18+
// Usage: node init-keys.js [kid]
// Outputs: ed25519-private.pem, ed25519-public.pem, info.json

const { generateKeyPairSync, createPublicKey } = require('crypto');
const { writeFileSync } = require('fs');

const kid = process.argv[2] || 'ed25519-v1';

const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
  publicKeyEncoding:  { format: 'pem', type: 'spki'  },
});

writeFileSync('ed25519-private.pem', privateKey, { mode: 0o600 });
writeFileSync('ed25519-public.pem',  publicKey,  { mode: 0o644 });

const spkiDer = createPublicKey(publicKey).export({ type: 'spki', format: 'der' });
const pubBase64 = Buffer.from(spkiDer).toString('base64');

writeFileSync('info.json', JSON.stringify({
  kid,
  algorithm: 'Ed25519',
  publicKey_pem: publicKey,
  publicKey_spki_base64: pubBase64
}, null, 2));

console.log('✔ Generated: ed25519-private.pem, ed25519-public.pem, info.json');
console.log('Paste this into your app as the public key (SPKI base64):');
console.log(pubBase64);
console.log('\nKeep ed25519-private.pem SECRET.');
