// ==========================================================
// RECORDING HISTORY (IndexedDB, used by the background worker)
//
// sessions: { id, startedAt, endedAt, tabUrl, tabTitle, apiCount, feCount, videoStartedAt }
// entries:  { key: "<sessionId>:<kind>:<step>", sessionId, kind: "api"|"fe", entry }
//
// Lets recordings survive a service-worker restart and be reopened later.
// Stored only on this device, inside the extension's own storage.
// ==========================================================

const DB_NAME = "flow-recorder";
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("entries")) {
        const store = db.createObjectStore("entries", { keyPath: "key" });
        store.createIndex("sessionId", "sessionId");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function result(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSession(session) {
  const db = await openDb();
  const tx = db.transaction("sessions", "readwrite");
  tx.objectStore("sessions").put(session);
  return done(tx);
}

export async function updateSession(id, patch) {
  const db = await openDb();
  const tx = db.transaction("sessions", "readwrite");
  const store = tx.objectStore("sessions");
  const existing = await result(store.get(id));
  if (existing) store.put({ ...existing, ...patch });
  return done(tx);
}

export async function putEntry(record) {
  const db = await openDb();
  const tx = db.transaction("entries", "readwrite");
  tx.objectStore("entries").put(record);
  return done(tx);
}

export async function listSessions() {
  const db = await openDb();
  const tx = db.transaction("sessions", "readonly");
  const all = await result(tx.objectStore("sessions").getAll());
  return all.sort((a, b) => b.startedAt - a.startedAt);
}

export async function getSession(id) {
  const db = await openDb();
  const tx = db.transaction("sessions", "readonly");
  return result(tx.objectStore("sessions").get(id));
}

export async function loadSessionFlows(sessionId) {
  const db = await openDb();
  const tx = db.transaction("entries", "readonly");
  const records = await result(
    tx.objectStore("entries").index("sessionId").getAll(sessionId),
  );
  records.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const api = [];
  const fe = [];
  for (const r of records) (r.kind === "api" ? api : fe).push(r);
  return { api, fe }; // records, so callers can keep the keys
}

export async function deleteSession(sessionId) {
  const db = await openDb();
  const tx = db.transaction(["sessions", "entries"], "readwrite");
  tx.objectStore("sessions").delete(sessionId);
  const index = tx.objectStore("entries").index("sessionId");
  const keys = await result(index.getAllKeys(sessionId));
  const entries = tx.objectStore("entries");
  keys.forEach((k) => entries.delete(k));
  return done(tx);
}

export async function clearAll() {
  const db = await openDb();
  const tx = db.transaction(["sessions", "entries"], "readwrite");
  tx.objectStore("sessions").clear();
  tx.objectStore("entries").clear();
  return done(tx);
}

// Keeps the newest `limit` sessions (never deleting `keepId`).
export async function prune(limit, keepId) {
  const sessions = await listSessions();
  const extra = sessions.filter((s) => s.id !== keepId).slice(Math.max(0, limit - 1));
  for (const s of extra) await deleteSession(s.id);
}
