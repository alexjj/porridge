// A tiny IndexedDB key-value store. Everything the editor keeps in the browser
// goes through here: file contents and per-browser UI state.

const DB_NAME = "porridge";
const STORE = "kv";

let dbPromise: Promise<IDBDatabase> | undefined;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req ? req.result : (undefined as T));
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export const kv = {
  get: <T>(key: string) => run<T | undefined>("readonly", (s) => s.get(key) as IDBRequest<T | undefined>),
  keys: () => run<IDBValidKey[]>("readonly", (s) => s.getAllKeys()),
  /** Writes and deletes in one transaction (`undefined` deletes). */
  setMany: (entries: [string, unknown][]) =>
    run<void>("readwrite", (s) => {
      for (const [k, v] of entries) {
        if (v === undefined) s.delete(k);
        else s.put(v, k);
      }
    }),
  clear: () =>
    run<void>("readwrite", (s) => {
      s.clear();
    }),
};
