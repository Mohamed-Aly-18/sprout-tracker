// A tiny drop-in replacement for the Claude-artifact `window.storage` API,
// backed by the browser's localStorage. It's synchronous under the hood but
// keeps the same async shape so the rest of the app doesn't need to change.

export const storage = {
  async get(key) {
    const value = localStorage.getItem(key);
    if (value === null) return null;
    return { key, value, shared: false };
  },
  async set(key, value) {
    localStorage.setItem(key, value);
    return { key, value, shared: false };
  },
  async delete(key) {
    const existed = localStorage.getItem(key) !== null;
    localStorage.removeItem(key);
    return { key, deleted: existed, shared: false };
  },
  async list(prefix = "") {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(prefix));
    return { keys, prefix, shared: false };
  },
};
