#!/usr/bin/env node
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");
const temporaryRoot = path.join(
  os.tmpdir(),
  `axein-desktop-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
);
const databaseDir = path.join(temporaryRoot, "pglite");
const uploadsDir = path.join(temporaryRoot, "uploads", "logos");
const logFile = path.join(temporaryRoot, "logs", "desktop-runtime.log");

function availablePort(preferred = 3199) {
  const listen = (port) =>
    new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        const address = server.address();
        const selected = typeof address === "object" && address ? address.port : port;
        server.close(() => resolve(selected));
      });
    });
  return listen(preferred).catch(() => listen(0));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/health`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body?.ok) return body;
    } catch {}
    await sleep(500);
  }
  throw new Error(`Health endpoint was not ready: ${url}`);
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { text };
  }
  if (!response.ok) {
    throw new Error(`${options.label || url} failed (${response.status}): ${body.error || text}`);
  }
  return body;
}

async function expectDocument(url, label) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${label} failed (${response.status}): ${await response.text()}`);
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 500) {
    throw new Error(`${label} returned an unexpectedly small document (${bytes.byteLength} bytes).`);
  }
}

async function expectDownload(url, label, minimumBytes = 100) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${label} failed (${response.status}): ${await response.text()}`);
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < minimumBytes) {
    throw new Error(`${label} returned an unexpectedly small file (${bytes.byteLength} bytes).`);
  }
}

async function main() {
  const port = Number(await availablePort());
  const baseUrl = `http://127.0.0.1:${port}`;
  const runtimeScript = path.join(root, "desktop", "scripts", "run-local-runtime.mjs");
  let child;

  const startRuntime = () => {
    child = spawn(process.execPath, [runtimeScript], {
      cwd: root,
      env: {
        ...process.env,
        AXEIN_DESKTOP: "1",
        AXEIN_FORCE_EMBEDDED_DB: "1",
        AXEIN_DB_DATA_DIR: databaseDir,
        AXEIN_UPLOADS_DIR: uploadsDir,
        AXEIN_LOG_FILE: logFile,
        HOSTNAME: "127.0.0.1",
        PORT: String(port),
      },
      stdio: "inherit",
    });
  };

  const stopRuntime = async () => {
    if (!child || child.exitCode !== null) return;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await Promise.race([exited, sleep(10000)]);
    if (child.exitCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
  };

  startRuntime();

  try {
    await waitForHealth(baseUrl);
    const trial = await jsonRequest(`${baseUrl}/api/license/start-trial`, {
      method: "POST",
      label: "Trial activation",
    });
    if (!trial?.ok) throw new Error("Trial activation did not return ok=true.");

    await jsonRequest(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "AxEin Desktop Smoke",
        business_type: "garage",
        phone: "7588937259",
        gstin: "27ABCDE1234F1Z5",
        state_code: "27",
        bank_name: "Smoke Bank",
      }),
      label: "Business settings",
    });

    const logoForm = new FormData();
    const onePixelPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZfMcAAAAASUVORK5CYII=",
      "base64"
    );
    logoForm.append("file", new Blob([onePixelPng], { type: "image/png" }), "smoke-logo.png");
    const logoUpload = await jsonRequest(`${baseUrl}/api/uploads/logo`, {
      method: "POST",
      body: logoForm,
      label: "Company logo upload",
    });
    if (!String(logoUpload?.url || "").startsWith("/api/uploads/logo/")) {
      throw new Error("Desktop logo upload did not return a persistent local asset URL.");
    }
    await expectDownload(`${baseUrl}${logoUpload.url}`, "Company logo read", 32);

    await jsonRequest(`${baseUrl}/api/categories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Healthcare" }),
      label: "Category creation",
    });

    const suffix = String(Date.now()).slice(-7);
    const product = await jsonRequest(`${baseUrl}/api/products`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `Smoke Medicine ${suffix}`,
        category: "Healthcare",
        hsn_code: "30049099",
        sku: `MED-${suffix}`,
        selling_price: 125,
        gst_slab: 12,
        stock_qty: 20,
        low_stock_threshold: 4,
        exp_date: "2028-12-31",
      }),
      label: "Product creation",
    });
    const productId = Number(product?.item?.id || 0);
    if (!productId) throw new Error("Product creation did not return an ID.");

    const productList = await jsonRequest(
      `${baseUrl}/api/products?q=${encodeURIComponent(`Smoke Medicine ${suffix}`)}&sort=name&dir=asc`,
      { label: "Product search" }
    );
    if (!productList?.items?.some((row) => Number(row.id) === productId)) {
      throw new Error("The new product was not returned by product search.");
    }

    const sale = await jsonRequest(`${baseUrl}/api/sales`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_name: `Smoke Patient ${suffix}`,
        patient_name: `Patient ${suffix}`,
        doctor_name: "Dr Smoke",
        vehicle_registration: `MH12SM${suffix.slice(-4)}`,
        vehicle_make_model: "AxEin Test Vehicle",
        odometer: "45000",
        job_card_no: `JOB-${suffix}`,
        service_advisor: "Smoke Advisor",
        amount_paid: 75,
        payment_method: "upi",
        items: [
          {
            product_id: productId,
            name: `Smoke Medicine ${suffix}`,
            qty: 1,
            unit_price: 125,
            discount_pct: 5,
            gst_slab: 12,
            batch_no: `LOT-${suffix}`,
            exp_date: "2028-12-31",
          },
        ],
      }),
      label: "Quick Billing sale",
    });
    const saleId = Number(sale?.id || 0);
    if (!saleId) throw new Error("Quick Billing sale did not return an invoice ID.");
    const saleDetail = await jsonRequest(`${baseUrl}/api/sales/${saleId}`, {
      label: "Quick Billing sale detail",
    });
    if (
      saleDetail?.sale?.patient_name !== `Patient ${suffix}` ||
      saleDetail?.sale?.vehicle_make_model !== "AxEin Test Vehicle"
    ) {
      throw new Error("Healthcare or garage invoice metadata was not preserved.");
    }
    const invoices = await jsonRequest(
      `${baseUrl}/api/invoices?q=${encodeURIComponent(String(sale.invoice_no || ""))}`,
      { label: "Invoice list" }
    );
    if (!invoices?.items?.some((row) => Number(row.id) === saleId)) {
      throw new Error("The saved Quick Billing invoice was not returned by the invoice list.");
    }
    await expectDocument(`${baseUrl}/api/invoices/${saleId}/pdf`, "Invoice PDF");

    const quotation = await jsonRequest(`${baseUrl}/api/quotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_name: `Smoke Customer ${suffix}`,
        notes: "Desktop runtime quotation",
        terms: "Valid for 30 days",
        vehicle_registration: `MH12QT${suffix.slice(-4)}`,
        vehicle_make_model: "AxEin Quotation Vehicle",
        odometer: "46000",
        job_card_no: `QJOB-${suffix}`,
        service_advisor: "Quotation Advisor",
        items: [
          {
            product_id: productId,
            description: `Smoke Medicine ${suffix}`,
            qty: 2,
            price: 125,
            tax: 12,
            discount: 10,
          },
        ],
      }),
      label: "Quotation creation",
    });
    const quotationId = Number(quotation?.data?.id || 0);
    if (!quotationId) throw new Error("Quotation creation did not return an ID.");
    await jsonRequest(`${baseUrl}/api/quotations/${quotationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_name: `Smoke Customer ${suffix}`,
        notes: "Desktop runtime quotation edited",
        terms: "Edited quotation terms",
        vehicle_registration: `MH12QT${suffix.slice(-4)}`,
        vehicle_make_model: "AxEin Quotation Vehicle Updated",
        odometer: "46500",
        job_card_no: `QJOB-${suffix}`,
        service_advisor: "Quotation Advisor",
        items: [
          {
            product_id: productId,
            description: `Smoke Medicine ${suffix}`,
            qty: 2,
            price: 130,
            tax: 12,
            discount: 10,
          },
        ],
      }),
      label: "Quotation edit",
    });
    const quotationDetail = await jsonRequest(`${baseUrl}/api/quotations/${quotationId}`, {
      label: "Quotation detail",
    });
    if (
      quotationDetail?.quotation?.meta?.notes !== "Desktop runtime quotation edited" ||
      quotationDetail?.quotation?.meta?.vehicle_make_model !== "AxEin Quotation Vehicle Updated"
    ) {
      throw new Error("Quotation edit or garage metadata was not preserved.");
    }
    await expectDocument(`${baseUrl}/api/quotations/${quotationId}/pdf`, "Quotation PDF");

    const purchase = await jsonRequest(`${baseUrl}/api/purchases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendor_name: `Smoke Supplier ${suffix}`,
        invoice_no: `PUR-${suffix}`,
        purchase_date: new Date().toISOString().slice(0, 10),
        amount_paid: 50,
        payment_method: "bank",
        add_to_inventory: true,
        items: [
          {
            product_id: productId,
            name: `Smoke Medicine ${suffix}`,
            qty: 3,
            cost_price: 80,
            mrp: 125,
            tax_rate: 12,
            discount: 0,
            batch_no: `PUR-LOT-${suffix}`,
            exp_date: "2029-06-30",
          },
        ],
      }),
      label: "Purchase creation",
    });
    const purchaseId = String(purchase?.purchase_id || "");
    if (!purchaseId) throw new Error("Purchase creation did not return an ID.");
    await jsonRequest(`${baseUrl}/api/purchases/${purchaseId}`, {
      label: "Purchase detail",
    });
    await expectDocument(`${baseUrl}/api/purchases/${purchaseId}/pdf`, "Purchase PDF");

    await jsonRequest(`${baseUrl}/api/accounting/debts`, { label: "Accounting debts" });
    await jsonRequest(`${baseUrl}/api/inventory/expiry?page=1&perPage=10`, {
      label: "Expiry inventory",
    });
    await jsonRequest(`${baseUrl}/api/alerts`, { label: "Alerts" });

    const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    await jsonRequest(`${baseUrl}/api/reports/tax?from=${from}&to=${to}&group=month`, {
      label: "Tax report",
    });
    await expectDownload(
      `${baseUrl}/api/reports/tax/export?format=csv&from=${from}&to=${to}&group=month`,
      "Tax report CSV"
    );

    const pageChecks = [
      "/dashboard",
      "/billing",
      "/products",
      "/inventory",
      "/inventory/low-stock",
      "/inventory/expiry",
      "/inventory/purchases",
      "/invoices",
      "/quotations",
      "/reports",
      "/accounting",
      "/settings",
    ];
    for (const page of pageChecks) {
      const response = await fetch(`${baseUrl}${page}`, { redirect: "manual" });
      if (response.status >= 500) {
        throw new Error(`Page check failed for ${page} (${response.status}).`);
      }
    }

    const backupResponse = await fetch(`${baseUrl}/api/admin/backup`, {
      method: "POST",
      headers: { "x-admin": "1" },
    });
    if (!backupResponse.ok) {
      throw new Error(`Backup failed (${backupResponse.status}): ${await backupResponse.text()}`);
    }
    const backupBytes = await backupResponse.arrayBuffer();
    if (backupBytes.byteLength < 1000) {
      throw new Error(`Backup returned an unexpectedly small archive (${backupBytes.byteLength} bytes).`);
    }

    const restoreCheck = await fetch(`${baseUrl}/api/admin/restore?apply=false`, {
      method: "POST",
      headers: {
        "x-admin": "1",
        "Content-Type": "application/zip",
      },
      body: backupBytes,
    });
    const restoreCheckBody = await restoreCheck.json().catch(() => ({}));
    if (!restoreCheck.ok || !restoreCheckBody?.report?.hasProducts) {
      throw new Error(
        `Backup verification failed (${restoreCheck.status}): ${restoreCheckBody?.error || "missing products"}`
      );
    }
    if (Number(restoreCheckBody?.report?.logoFilesCount || 0) < 1) {
      throw new Error("Backup verification did not find the uploaded company logo.");
    }

    const restoreApply = await fetch(`${baseUrl}/api/admin/restore?apply=true`, {
      method: "POST",
      headers: {
        "x-admin": "1",
        "Content-Type": "application/zip",
      },
      body: backupBytes,
    });
    const restoreApplyBody = await restoreApply.json().catch(() => ({}));
    if (!restoreApply.ok || !restoreApplyBody?.applied) {
      throw new Error(
        `Backup restore failed (${restoreApply.status}): ${restoreApplyBody?.error || "not applied"}`
      );
    }

    await stopRuntime();
    await sleep(300);
    startRuntime();
    await waitForHealth(baseUrl);

    const persistedProducts = await jsonRequest(
      `${baseUrl}/api/products?q=${encodeURIComponent(`Smoke Medicine ${suffix}`)}`,
      { label: "Product persistence after restart" }
    );
    if (!persistedProducts?.items?.some((row) => Number(row.id) === productId)) {
      throw new Error("Product data did not persist across a desktop runtime restart.");
    }
    const persistedInvoices = await jsonRequest(
      `${baseUrl}/api/invoices?q=${encodeURIComponent(String(sale.invoice_no || ""))}`,
      { label: "Invoice persistence after restart" }
    );
    if (!persistedInvoices?.items?.some((row) => Number(row.id) === saleId)) {
      throw new Error("Invoice data did not persist across a desktop runtime restart.");
    }
    await expectDownload(`${baseUrl}${logoUpload.url}`, "Company logo after restart", 32);

    console.log("Desktop embedded runtime smoke test passed.");
  } finally {
    await stopRuntime();
    await fs.rm(temporaryRoot, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error("Desktop embedded runtime smoke test failed:", error.message || error);
  process.exit(1);
});
