// app/api/uploads/logo/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import path from "node:path";
import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);
const EXT_FROM_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

function extFromName(name: string): string | null {
  const m = name.toLowerCase().match(/\.([a-z0-9]{2,8})$/i);
  if (!m) return null;
  const e = m[1];
  if (["png", "jpg", "jpeg", "webp"].includes(e)) {
    return e === "jpeg" ? "jpg" : e;
  }
  return null;
}

function makeFilename(ext: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const short = crypto.randomUUID().slice(0, 8);
  return `logo_${stamp}_${short}.${ext}`;
}

export async function POST(req: Request) {
  try {
    const ctype = req.headers.get("content-type") || "";
    if (!ctype.toLowerCase().includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Content-Type must be multipart/form-data" },
        { status: 415 }
      );
    }

    const form = await req.formData().catch(() => null);
    if (!form) {
      return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
    }

    // Validate type
    const mime = (file.type || "").toLowerCase();
    if (!ALLOWED.has(mime)) {
      return NextResponse.json(
        { error: "Only PNG, JPG, or WebP images are allowed" },
        { status: 400 }
      );
    }

    // Read into memory to check size / write to disk
    const ab = await file.arrayBuffer();
    const size = ab.byteLength;
    if (size <= 0) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 });
    }
    if (size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large. Max ${Math.round(MAX_BYTES / (1024 * 1024))} MB` },
        { status: 413 }
      );
    }

    // Resolve extension
    const byMime = EXT_FROM_MIME[mime];
    const byName = extFromName(file.name || "");
    const ext = (byMime || byName || "png").toLowerCase();

    // Ensure upload dir exists
    const dir = path.join(process.cwd(), "public", "uploads", "logos");
    await mkdir(dir, { recursive: true });

    // Generate unique filename & write
    const filename = makeFilename(ext);
    const filepath = path.join(dir, filename);

    // Use Uint8Array to satisfy Node's writeFile typing
    const u8 = new Uint8Array(ab);
    await writeFile(filepath, u8);

    // Public URL (served by Next static from /public)
    const url = `/uploads/logos/${filename}`;

    return NextResponse.json({ url }, { status: 200 });
  } catch (err: any) {
    console.error("Logo upload failed:", err?.message || err);
    return NextResponse.json(
      { error: "Upload failed", detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}

// (Optional) Reject other methods clearly
export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
