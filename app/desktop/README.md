# AxEin Billing Desktop

AxEin Billing for Windows and macOS packages the current Next.js application
with a private Node.js runtime and a persistent PGlite database. Customers do
not need Docker, PostgreSQL, Redis, MinIO, Node.js, Git, or source code.

## Customer requirements

- Windows 10/11 64-bit, or macOS 11+
- 4 GB RAM minimum, 8 GB recommended
- 2 GB free disk space
- Internet access for download and first-device activation

The application server listens only on `127.0.0.1`. Billing data is stored under
the operating system's per-user AxEin Billing data directory and remains across
application upgrades and computer restarts.

## Build requirements

- Node.js 20 LTS
- npm
- Windows packages must be built on Windows
- Intel macOS packages must be built on an Intel macOS runner
- Apple Silicon packages must be built on an arm64 macOS runner

## Validate the embedded runtime

From the application root:

```bash
npm ci
npm run desktop:web:build
npm run desktop:prepare-runtime
npm run desktop:runtime:smoke
```

The smoke test uses a temporary embedded database and verifies products,
categories, Quick Billing, partial payments, invoices, quotations, purchases,
inventory, accounting, alerts, tax reports, PDFs, and the primary application
pages.

## Build installers

Install the desktop packager once:

```bash
cd desktop
npm ci
```

Windows:

```bash
npm run dist:win
```

macOS Apple Silicon:

```bash
npm run dist:mac:arm64
```

macOS Intel:

```bash
npm run dist:mac:x64
```

Generated installers are written to `desktop/dist/`.

## Runtime contents

`npm run desktop:runtime` generates `desktop/runtime/` with:

- the current Next.js standalone production server;
- public and static application assets;
- every current database migration;
- the embedded PGlite engine;
- a platform-native Node.js 20 runtime;
- public license verification metadata only.

The private license signing key is never copied into customer installers.
