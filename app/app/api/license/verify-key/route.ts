// app/api/license/verify-key/route.ts
import { NextResponse } from "next/server";
import {
  verifySignatureEd25519,
  saveActivationRecord,
} from "@/app/lib/license-activation";

function bad(msg: string, status = 400) {
  return NextResponse.json(
    { ok: false, error: msg },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

// Token format: "L-<LICENSE_KEY>.<base64url(payload)>.<base64url(signature)>"
// payload JSON: { email: string, expires_at: string }
function parsePackedToken(raw: string) {
  const s = (raw || "").trim();
  if (!s.startsWith("L-")) throw new Error("Token must start with L-");
  const parts = s.split(".");
  if (parts.length < 3) throw new Error("Malformed token");

  const licenseKeyPart = parts[0].slice(2); // remove "L-"
  const payloadB64u = parts[1];
  const sigB64u = parts[2];

  const toB64 = (u: string) => u.replace(/-/g, "+").replace(/_/g, "/");
  const payloadJson = Buffer.from(toB64(payloadB64u), "base64").toString("utf8");

  let payload: { email: string; expires_at: string };
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    throw new Error("Invalid token payload");
  }

  const signatureB64 = Buffer.from(toB64(sigB64u), "base64").toString("base64");

  return {
    license_key: licenseKeyPart,
    email: payload.email,
    expires_at: payload.expires_at,
    signature: signatureB64,
  };
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));

    // --- Normalize inputs from multiple shapes ----------------------------
    // Supported:
    //  A) { token: "L-..." }  (packed token)
    //  B) { license_key, email, expires_at, signature } (JSON)
    //  C) { license_key: "L-..." }  (old client sending token under license_key)
    //  D) { license_key: "{...json...}" } (user pasted JSON into single box)
    let license_key = "";
    let email: string | undefined;
    let expires_at: string | undefined;
    let signature: string | undefined;

    const rawTokenOrKey: string | undefined =
      typeof body?.token === "string"
        ? body.token
        : typeof body?.license_key === "string"
        ? body.license_key
        : undefined;

    const looksPacked = (s?: string) => !!s && s.startsWith("L-");

    if (looksPacked(rawTokenOrKey)) {
      // Packed token path
      const parsed = parsePackedToken(rawTokenOrKey!);
      license_key = parsed.license_key;
      email = parsed.email;
      expires_at = parsed.expires_at;
      signature = parsed.signature;
    } else if (
      typeof rawTokenOrKey === "string" &&
      rawTokenOrKey.trim().startsWith("{")
    ) {
      // JSON pasted into single box
      try {
        const j = JSON.parse(rawTokenOrKey.trim());
        license_key = String(j.license_key || "");
        email = String(j.email || "");
        expires_at = String(j.expires_at || "");
        signature = String(j.signature || "");
      } catch {
        return bad("Invalid JSON pasted into license box");
      }
    } else if (
      body?.license_key &&
      body?.email &&
      body?.expires_at &&
      body?.signature
    ) {
      // Proper JSON fields
      license_key = String(body.license_key);
      email = String(body.email);
      expires_at = String(body.expires_at);
      signature = String(body.signature);
    } else {
      return bad("Missing license token or required fields");
    }

    if (!license_key || !email || !expires_at || !signature) {
      return bad("Incomplete license payload");
    }

    const PUBLIC_KEY = process.env.LICENSE_PUBLIC_KEY || "";
    if (!PUBLIC_KEY) return bad("Server missing LICENSE_PUBLIC_KEY", 500);

    // Verify signature: pass payload object (without signature)
    const ok = verifySignatureEd25519(
      { license_key, email, expires_at },
      signature,
      PUBLIC_KEY
    );
    if (!ok) return bad("Invalid license signature", 401);

    // Persist activation (only known fields accepted by your type)
    await saveActivationRecord({
      mode: "active",
      ok: true,
      reason: null,
      license: { license_key, email, expires_at },
    });

    return NextResponse.json(
      {
        ok: true,
        isLicensed: true,
        trialActive: false,
        status: { mode: "active", license: { license_key, email, expires_at } },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return bad(e?.message || "License verification failed", 500);
  }
}
