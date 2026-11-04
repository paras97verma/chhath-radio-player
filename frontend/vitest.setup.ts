import "@testing-library/jest-dom";

// Ensure Node 22+ does not shadow jsdom localStorage/sessionStorage
if (typeof window !== "undefined") {
  const createStorage = () => {
    let store: Record<string, string> = {};
    return {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = String(value);
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
      key: (i: number) => Object.keys(store)[i] ?? null,
      get length() {
        return Object.keys(store).length;
      },
    };
  };

  const ls = (window.localStorage && typeof window.localStorage.clear === "function") ? window.localStorage : createStorage();
  const ss = (window.sessionStorage && typeof window.sessionStorage.clear === "function") ? window.sessionStorage : createStorage();

  Object.defineProperty(window, "localStorage", { value: ls, configurable: true, writable: true });
  Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true, writable: true });
  Object.defineProperty(window, "sessionStorage", { value: ss, configurable: true, writable: true });
  Object.defineProperty(globalThis, "sessionStorage", { value: ss, configurable: true, writable: true });
}