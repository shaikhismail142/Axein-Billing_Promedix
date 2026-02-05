# AxEin Billing – Offline License Keygen

This folder contains **offline tools** to generate and sign license keys
for the billing app. Keys are verified **inside the app** using Ed25519
public keys baked into the code.  
⚠️ Keep your private key files secret — never commit them.

---

## Files

- `init-keys.js`  
  One-time script to generate an Ed25519 keypair:
  - `ed25519-private.pem` (secret, keep offline)
  - `ed25519-public.pem` (can be shared, used for verification)
  - `info.json` (contains public key in base64 for pasting into the app)

- `issue-license.js`  
  Issues a license token by signing a JSON payload.  
  Output token format:

