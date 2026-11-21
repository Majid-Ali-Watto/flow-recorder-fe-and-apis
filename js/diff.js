// ==========================================================
// FLOW COMPARISON — matches requests between two recordings and reports
// status, timing and response-body differences. Pure functions.
// ==========================================================

const VOLATILE_KEY_RE =
  /(^|[_-])(id|uuid|guid|nonce|token|etag|timestamp|time|date|created|updated|modified|expires?)$|At$|Id$|^(id|ts|now)$/;

// Treat ids and hashes in paths as placeholders so /users/42 matches /users/57.
export function normalizePath(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return String(url || "");
  }
  const path = u.pathname
    .split("/")
    .map((seg) =>
      /^\d+$/.test(seg) || /^[0-9a-f]{8,}$/i.test(seg) || /^[0-9a-f-]{32,36}$/i.test(seg) ? ":id" : seg,
    )
    .join("/");
  return `${u.host}${path}`;
}

function requestKey(entry) {
  return `${entry.request?.method || "?"} ${normalizePath(entry.request?.url)}`;
}

function parse(value) {
  if (value == null) return undefined;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

function preview(v) {
  if (v === undefined) return "(missing)";
  const s = typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v);
  return s && s.length > 120 ? `${s.slice(0, 117)}…` : s;
}

// Collects up to `limit` differences between two JSON values.
export function jsonDiff(a, b, { ignoreVolatile = false, limit = 50 } = {}) {
  const out = [];
  const walk = (x, y, path, key) => {
    if (out.length >= limit) return;
    if (ignoreVolatile && key && VOLATILE_KEY_RE.test(key)) return;
    const tx = typeOf(x);
    const ty = typeOf(y);
    if (x === undefined || y === undefined || tx !== ty) {
      if (x !== y) out.push({ path, a: preview(x), b: preview(y) });
      return;
    }
    if (tx === "array") {
      const n = Math.max(x.length, y.length);
      for (let i = 0; i < n && out.length < limit; i++) walk(x[i], y[i], `${path}[${i}]`, null);
      return;
    }
    if (tx === "object") {
      const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
      for (const k of keys) {
        if (out.length >= limit) break;
        walk(x[k], y[k], /^[a-z_$][\w$]*$/i.test(k) ? `${path}.${k}` : `${path}[${JSON.stringify(k)}]`, k);
      }
      return;
    }
    if (x !== y) out.push({ path, a: preview(x), b: preview(y) });
  };
  walk(a, b, "$", null);
  return out;
}

// Pairs the nth occurrence of each request key in A with the nth in B.
export function diffFlows(flowA, flowB, { ignoreVolatile = true } = {}) {
  const requestsOf = (flow) => (flow || []).filter((e) => e.type === "API");
  const bucket = (flow) => {
    const map = new Map();
    for (const e of requestsOf(flow)) {
      const k = requestKey(e);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(e);
    }
    return map;
  };
  const a = bucket(flowA);
  const b = bucket(flowB);
  const keys = [...new Set([...a.keys(), ...b.keys()])];

  const rows = [];
  for (const key of keys) {
    const listA = a.get(key) || [];
    const listB = b.get(key) || [];
    const n = Math.max(listA.length, listB.length);
    for (let i = 0; i < n; i++) {
      const ea = listA[i] || null;
      const eb = listB[i] || null;
      const row = {
        key,
        occurrence: i + 1,
        method: (ea || eb).request?.method || "?",
        url: (ea || eb).request?.url || "",
        a: ea,
        b: eb,
        statusA: ea?.response?.status ?? (ea?.error ? "ERR" : null),
        statusB: eb?.response?.status ?? (eb?.error ? "ERR" : null),
        durationA: ea?.durationMs ?? null,
        durationB: eb?.durationMs ?? null,
        changes: [],
      };
      if (ea && eb) {
        row.changes = jsonDiff(parse(ea.responseBody), parse(eb.responseBody), { ignoreVolatile });
        row.statusChanged = row.statusA !== row.statusB;
        row.state = row.statusChanged || row.changes.length ? "changed" : "same";
      } else {
        row.state = ea ? "onlyA" : "onlyB";
      }
      rows.push(row);
    }
  }

  const order = { changed: 0, onlyA: 1, onlyB: 2, same: 3 };
  rows.sort((x, y) => order[x.state] - order[y.state] || x.key.localeCompare(y.key));

  const count = (s) => rows.filter((r) => r.state === s).length;
  return {
    rows,
    summary: {
      total: rows.length,
      same: count("same"),
      changed: count("changed"),
      onlyA: count("onlyA"),
      onlyB: count("onlyB"),
    },
  };
}
