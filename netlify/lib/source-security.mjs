import { isIP } from "node:net";
import dns from "node:dns/promises";

const PRIVATE_IPV4_RANGES = [
  ["10.0.0.0", "10.255.255.255"],
  ["127.0.0.0", "127.255.255.255"],
  ["169.254.0.0", "169.254.255.255"],
  ["172.16.0.0", "172.31.255.255"],
  ["192.168.0.0", "192.168.255.255"],
];

const METADATA_IPS = new Set([
  "169.254.169.254",
  "100.100.100.200",
]);

function ipv4ToInt(address) {
  return address.split(".").reduce((sum, part) => (sum << 8) + Number(part), 0) >>> 0;
}

function isPrivateIpv4(address) {
  if (METADATA_IPS.has(address)) {
    return true;
  }
  const value = ipv4ToInt(address);
  return PRIVATE_IPV4_RANGES.some(([start, end]) => value >= ipv4ToInt(start) && value <= ipv4ToInt(end));
}

function isPrivateIpv6(address) {
  const normalized = String(address || "").trim().toLowerCase();
  return (
    normalized === "::1" ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized === "::ffff:127.0.0.1" ||
    normalized === "::ffff:169.254.169.254"
  );
}

function isBlockedHostname(hostname) {
  const normalized = String(hostname || "").trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "metadata.google.internal" ||
    normalized.endsWith(".internal")
  );
}

function isDevelopmentMode() {
  return process.env.NODE_ENV !== "production" && !process.env.NETLIFY;
}

export async function validateExternalUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("כתובת ה-API אינה תקינה.");
  }

  const allowHttp = isDevelopmentMode();
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("מותר להשתמש רק ב-HTTPS, או ב-HTTP מקומי בסביבת פיתוח.");
  }
  if (parsed.protocol === "http:" && !allowHttp) {
    throw new Error("בפרודקשן מותר להשתמש רק ב-HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("אין להעביר פרטי גישה כחלק מה-URL.");
  }
  if (isBlockedHostname(parsed.hostname)) {
    throw new Error("הכתובת מצביעה ליעד פנימי שאינו מורשה.");
  }

  const ipVersion = isIP(parsed.hostname);
  if (ipVersion === 4 && isPrivateIpv4(parsed.hostname)) {
    throw new Error("הכתובת מצביעה ל-IP פרטי או מקומי שאינו מורשה.");
  }
  if (ipVersion === 6 && isPrivateIpv6(parsed.hostname)) {
    throw new Error("הכתובת מצביעה ל-IP פנימי שאינו מורשה.");
  }

  if (!ipVersion) {
    try {
      const records = await dns.lookup(parsed.hostname, { all: true, verbatim: true });
      if ((records || []).some((record) => (record.family === 4 ? isPrivateIpv4(record.address) : isPrivateIpv6(record.address)))) {
        throw new Error("הכתובת נפתרת ליעד פנימי או פרטי שאינו מורשה.");
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("שאינו מורשה")) {
        throw error;
      }
    }
  }

  return parsed;
}

async function readLimitedResponseBody(response, maxBytes) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) {
      throw new Error("תגובת ה-API חורגת ממגבלת הגודל המותרת.");
    }
    return text;
  }

  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      throw new Error("תגובת ה-API חורגת ממגבלת הגודל המותרת.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function safeFetchUrl(rawUrl, options = {}) {
  const timeoutMs = options.timeoutMs || 15000;
  const maxBytes = options.maxBytes || 5 * 1024 * 1024;
  const maxRedirects = options.maxRedirects || 3;
  const method = options.method || "GET";
  const headers = options.headers || {};
  const body = options.body;

  let currentUrl = rawUrl;
  let redirects = 0;
  while (redirects <= maxRedirects) {
    const parsed = await validateExternalUrl(currentUrl);
    const response = await fetch(parsed, {
      method,
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("ה-API החזיר הפניה ללא כתובת יעד.");
      }
      currentUrl = new URL(location, parsed).toString();
      redirects += 1;
      continue;
    }

    const text = await readLimitedResponseBody(response, maxBytes);
    return {
      response,
      text,
      finalUrl: parsed.toString(),
    };
  }

  throw new Error("נחסמה שרשרת הפניות ארוכה מדי.");
}
