#!/usr/bin/env node
/**
 * AxEin License CLI
 * Commands:
 *   node tools/license-keygen/cli.js init
 *   node tools/license-keygen/cli.js issue --key AXEIN-XXXX-XXXX-XXXX --email user@ex.com --expires 2026-12-31
 *   node tools/license-keygen/cli.js issue (interactive prompts)
 *   node tools/license-keygen/cli.js verify ./licenses/AXEIN-XXXX.json
 *
 * Requires:
 *   tools/license-keygen/ed25519-private.pem
 *   tools/license-keygen/info.json  (contains base64 SPKI public key)
 */

 import fs from "node:fs";
 import path from "node:path";
 import crypto from "node:crypto";
 import readline from "node:readline";
 
 const ROOT = process.cwd();
 const TOOLS_DIR = path.join(ROOT, "tools", "license-keygen");
 const PRIV = path.join(TOOLS_DIR, "ed25519-private.pem");
 const INFO = path.join(TOOLS_DIR, "info.json");
 const OUT_DIR = path.join(TOOLS_DIR, "licenses");
 
 function ensureDirs() {
   fs.mkdirSync(TOOLS_DIR, { recursive: true });
   fs.mkdirSync(OUT_DIR, { recursive: true });
 }
 
 function rand4() {
   return Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[^A-Z0-9]/g, "0");
 }
 
 function genKey() {
   return `AXEIN-${rand4()}-${rand4()}-${rand4()}`;
 }
 
 function canonical(license_key, email, expires_at) {
   return `${license_key}\n${email}\n${expires_at}`;
 }
 
 function signEd25519(privatePem, data) {
   const sig = crypto.sign(null, Buffer.from(data), crypto.createPrivateKey(privatePem));
   return sig.toString("base64");
 }
 
 function loadPublicKey() {
   const j = JSON.parse(fs.readFileSync(INFO, "utf8"));
   const spkiBase64 = j?.publicKeyBase64 || j?.public || j?.spki;
   if (!spkiBase64) throw new Error("info.json missing SPKI base64 (publicKeyBase64).");
   return crypto.createPublicKey({
     key: Buffer.from(spkiBase64, "base64"),
     format: "der",
     type: "spki",
   });
 }
 
 function verify(publicKey, data, signatureB64) {
   return crypto.verify(null, Buffer.from(data), publicKey, Buffer.from(signatureB64, "base64"));
 }
 
 async function promptInteractive(defaults = {}) {
   const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
   const q = (s) => new Promise((res) => rl.question(s, res));
 
   let lk = await q(`License key [auto]: `);
   if (!lk) lk = genKey();
 
   let email = await q(`Email: `);
   while (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
     email = await q(`  Please enter a valid email: `);
   }
 
   let expires = await q(`Expires (YYYY-MM-DD): `);
   while (!/^\d{4}-\d{2}-\d{2}$/.test(expires)) {
     expires = await q(`  Please use YYYY-MM-DD: `);
   }
 
   rl.close();
   return { license_key: lk, email, expires_at: `${expires}T23:59:59.000Z` };
 }
 
 function parseArgs() {
   const [, , cmd, ...rest] = process.argv;
   const args = {};
   for (let i = 0; i < rest.length; i++) {
     if (rest[i].startsWith("--")) {
       const key = rest[i].slice(2);
       const val = rest[i + 1]?.startsWith("--") || rest[i + 1] == null ? true : rest[++i];
       args[key] = val;
     }
   }
   return { cmd, args };
 }
 
 async function cmdInit() {
   ensureDirs();
   const privPath = PRIV;
   if (fs.existsSync(privPath) && fs.existsSync(INFO)) {
     console.log("Keys already exist. Nothing to do.");
     return;
   }
   // Generate Ed25519 pair
   const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
   const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
   const publicSpkiDer = publicKey.export({ type: "spki", format: "der" });
   fs.writeFileSync(PRIV, privatePem, { mode: 0o600 });
   fs.writeFileSync(INFO, JSON.stringify({ publicKeyBase64: Buffer.from(publicSpkiDer).toString("base64") }, null, 2));
   console.log("Generated: ed25519-private.pem, info.json");
   console.log("Public key (SPKI base64) — set as LICENSE_PUBLIC_KEY env:");
   console.log(JSON.parse(fs.readFileSync(INFO, "utf8")).publicKeyBase64);
 }
 
 async function cmdIssue(args) {
   ensureDirs();
   if (!fs.existsSync(PRIV)) throw new Error("Missing ed25519-private.pem. Run: cli.js init");
 
   let payload;
   if (args.key && args.email && args.expires) {
     const expiresISO = /^\d{4}-\d{2}-\d{2}$/.test(args.expires)
       ? `${args.expires}T23:59:59.000Z`
       : args.expires;
     payload = { license_key: args.key, email: args.email, expires_at: expiresISO };
   } else {
     payload = await promptInteractive();
   }
 
   const privPem = fs.readFileSync(PRIV, "utf8");
   const canonicalStr = canonical(payload.license_key, payload.email, payload.expires_at);
   const signature = signEd25519(privPem, canonicalStr);
 
   const out = { ...payload, signature };
   const safeName = payload.license_key.replace(/[^A-Z0-9-]/gi, "_");
   const outJson = path.join(OUT_DIR, `${safeName}.json`);
   const outTxt = path.join(OUT_DIR, `${safeName}.txt`);
 
   fs.writeFileSync(outJson, JSON.stringify(out, null, 2));
   fs.writeFileSync(
     outTxt,
     [
       `license_key=${payload.license_key}`,
       `email=${payload.email}`,
       `expires_at=${payload.expires_at}`,
       `signature=${signature}`,
     ].join("\n")
   );
 
   console.log("Issued license:");
   console.log(out);
   console.log(`Saved:\n  ${outJson}\n  ${outTxt}`);
   console.log("\nActivate with:");
   console.log(
     `curl -X POST http://localhost:3000/api/license/verify-key -H "Content-Type: application/json" -d '${JSON.stringify(
       out
     )}'`
   );
 }
 
 async function cmdVerify(args) {
   const file = args._?.[0] || Object.keys(args).find((k) => k.endsWith(".json")) || null;
   const target = file || args.file || args.f;
   if (!target) {
     console.error("Usage: cli.js verify ./licenses/KEY.json");
     process.exit(1);
   }
   const data = JSON.parse(fs.readFileSync(target, "utf8"));
   const { license_key, email, expires_at, signature } = data;
   const pub = loadPublicKey();
   const ok = verify(pub, canonical(license_key, email, expires_at), signature);
   console.log(ok ? "Signature OK" : "Signature INVALID");
 }
 
 (async function main() {
   const { cmd, args } = parseArgs();
   try {
     if (cmd === "init") return await cmdInit();
     if (cmd === "issue") return await cmdIssue(args);
     if (cmd === "verify") return await cmdVerify({ _: process.argv.slice(3), ...args });
     console.log(`Usage:
   node tools/license-keygen/cli.js init
   node tools/license-keygen/cli.js issue [--key AXEIN-ABCD-EFGH-IJKL --email a@b.com --expires 2026-12-31]
   node tools/license-keygen/cli.js verify ./tools/license-keygen/licenses/AXEIN-ABCD.json
 `);
   } catch (e) {
     console.error("Error:", e?.message || e);
     process.exit(1);
   }
 })();
 