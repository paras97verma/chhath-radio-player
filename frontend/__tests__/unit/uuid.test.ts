import { describe, it, expect, vi } from "vitest";
import { generateUUID } from "@/lib/uuid";

describe("generateUUID", () => {
  it("generates valid RFC4122 v4 UUID in secure context", () => {
    const id = generateUUID();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("falls back gracefully when crypto.randomUUID is undefined (e.g. non-secure http://192.168.x.x)", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
        return arr;
      },
    });

    const id = generateUUID();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    vi.unstubAllGlobals();
  });

  it("falls back to pure Math.random when crypto is completely undefined", () => {
    vi.stubGlobal("crypto", undefined);

    const id = generateUUID();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    vi.unstubAllGlobals();
  });
});
