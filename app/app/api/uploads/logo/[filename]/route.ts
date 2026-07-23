export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import path from "node:path";
import { readFile } from "node:fs/promises";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function safeFilename(value: string) {
  const name = path.basename(value || "");
  const extension = path.extname(name).toLowerCase();
  if (!/^logo_[a-zA-Z0-9_.-]+$/.test(name) || !MIME_BY_EXTENSION[extension]) {
    return null;
  }
  return { name, extension };
}

export async function GET(
  _req: Request,
  { params }: { params: { filename: string } }
) {
  const file = safeFilename(decodeURIComponent(params.filename || ""));
  if (!file) {
    return NextResponse.json({ error: "Invalid logo filename" }, { status: 400 });
  }

  const directory = process.env.AXEIN_UPLOADS_DIR
    ? path.resolve(process.env.AXEIN_UPLOADS_DIR)
    : path.join(process.cwd(), "public", "uploads", "logos");

  try {
    const bytes = await readFile(path.join(directory, file.name));
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": MIME_BY_EXTENSION[file.extension],
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Logo not found" }, { status: 404 });
  }
}
