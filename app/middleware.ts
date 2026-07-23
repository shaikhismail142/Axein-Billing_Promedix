import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

// Keep headers no-store to avoid caching activation status
const NO_STORE_HEADERS = {
  "cache-control": "no-store",
};

function isSafeReadOnlyOperation(pathname: string) {
  return (
    pathname.startsWith("/api/license") ||
    pathname.startsWith("/api/admin/backup") ||
    pathname.includes("/print") ||
    pathname.includes("/pdf") ||
    pathname.includes("/export")
  );
}

function licenseUnavailableResponse() {
  return NextResponse.json(
    {
      ok: false,
      code: "LICENSE_STATUS_UNAVAILABLE",
      error: "License status is temporarily unavailable. Viewing remains available, but changes are paused.",
    },
    { status: 503 }
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow static and public assets without checks
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/assets/") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".css") ||
    pathname.endsWith(".map") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".svg")
  ) {
    return NextResponse.next();
  }

  // Allow activation routes and license APIs themselves
  if (
    pathname.startsWith("/activate") ||
    pathname.startsWith("/api/license") ||
    pathname === "/api/health"
  ) {
    return NextResponse.next();
  }

  // Probe license status only
  const licURL = req.nextUrl.clone();
  licURL.pathname = "/api/license/status";
  licURL.search = "";

  try {
    const licRes = await fetch(licURL, {
      cache: "no-store",
      headers: NO_STORE_HEADERS as any,
    });

    if (!licRes.ok) {
      if (
        ["GET", "HEAD", "OPTIONS"].includes(req.method) ||
        isSafeReadOnlyOperation(pathname)
      ) {
        return NextResponse.next();
      }
      return licenseUnavailableResponse();
    }
    const j = (await licRes.json().catch(() => ({}))) as any;

    // If licensed or actively on trial, allow through
    if (j?.readOnly && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (!isSafeReadOnlyOperation(pathname)) {
        return NextResponse.json(
          {
            ok: false,
            code: "LICENSE_READ_ONLY",
            error: "Axein Billing is in read-only mode. Connect to the internet to refresh the license.",
          },
          { status: 423 }
        );
      }
    }
    if (j?.isLicensed || j?.trialActive || j?.canStartTrial) {
      return NextResponse.next();
    }
    // Else, redirect to /activate (but avoid loops)
    if (!pathname.startsWith("/activate")) {
      const url = req.nextUrl.clone();
      url.pathname = "/activate";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  } catch {
    if (
      ["GET", "HEAD", "OPTIONS"].includes(req.method) ||
      isSafeReadOnlyOperation(pathname)
    ) {
      return NextResponse.next();
    }
    return licenseUnavailableResponse();
  }
}

// Run middleware on all app paths (adjust as you need)
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
