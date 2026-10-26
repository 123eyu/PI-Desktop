import { describe, expect, it } from "vitest";
import golden from "./fixtures/binary-storage.json";
import { decodeBinaryStorage, encodeBinaryStorage } from "./binary-storage.js";

const image = (data = "A/B=") => ({ type: "image", mimeType: "image/png", data });
const record = () => {
  const toolResult = {
    content: [image()],
    details: { images: [{ mimeType: "image/png", data: "A/B=" }] },
  };
  return { id: "m", content: JSON.stringify(toolResult), toolResult };
};

describe("lossless binary storage", () => {
  it("matches the common v1 golden envelope and preserves exact text spellings", () => {
    expect(encodeBinaryStorage(golden.original)).toEqual(golden.encoded);
    expect(decodeBinaryStorage(golden.encoded)).toEqual(golden.original);
  });

  it("stores four business copies once without mutating the input", () => {
    const original = record();
    const before = structuredClone(original);
    const encoded = encodeBinaryStorage(original);
    expect(JSON.stringify(encoded).split("A/B=").length - 1).toBe(1);
    expect(decodeBinaryStorage(JSON.parse(JSON.stringify(encoded)))).toEqual(original);
    expect(original).toEqual(before);
    expect(decodeBinaryStorage(encoded)).toEqual(before);
    expect(encoded).not.toEqual(before);
  });

  it("leaves legacy records, single images, generic data and non-ASCII data unchanged", () => {
    for (const original of [
      null,
      [1, "ordinary"],
      { content: [image()] },
      { a: { data: "A/B=" }, b: { data: "A/B=" } },
      { content: [image("中文"), image("中文")] },
    ]) {
      expect(encodeBinaryStorage(original)).toEqual(original);
      expect(decodeBinaryStorage(original)).toEqual(original);
    }
  });

  it("encodes resources, images arrays and all unknown metadata losslessly", () => {
    const original = {
      nested: {
        result: {
          content: [
            { type: "resource", resource: { uri: "test:", mimeType: "image/png", blob: "A/B=" } },
          ],
          images: [{ mimeType: "image/png", data: "A/B=", unknown: true }],
        },
        text: "ordinary",
      },
      usage: { unknown: [2, "x"] },
    };
    const encoded = encodeBinaryStorage(original);
    expect(JSON.stringify(encoded).split("A/B=").length - 1).toBe(1);
    expect(decodeBinaryStorage(encoded)).toEqual(original);
  });

  it("does not template JSON that differs from a sibling result", () => {
    const original = {
      content: JSON.stringify({ content: [image()], extra: 1 }),
      toolResult: { content: [image(), image()] },
      text: "A/B=",
      unknown: "A/B=",
    };
    const encoded = encodeBinaryStorage(original) as typeof original;
    expect(encoded.content).toBe(original.content);
    expect(encoded.text).toBe(original.text);
    expect(encoded.unknown).toBe(original.unknown);
    expect(decodeBinaryStorage(encoded)).toEqual(original);
  });

  it("supports text mirrors, multiple images and escaped property names", () => {
    const result = { content: [image("AA=="), image("BB==")] };
    const text = JSON.stringify(result).replace('"data"', '"d\\u0061ta"');
    const original = { messages: [{ result, text, metadata: { source: "unknown" } }] };
    const encoded = encodeBinaryStorage(original);
    expect(JSON.stringify(encoded).split("AA==").length - 1).toBe(1);
    expect(JSON.stringify(encoded).split("BB==").length - 1).toBe(1);
    expect(decodeBinaryStorage(encoded)).toEqual(original);
  });

  it("retains literal duplicate JSON keys while templating only matching image values", () => {
    const result = { content: [image()] };
    const original = {
      result,
      content:
        '{"ignored":0,"ignored":1,"content":[{"type":"image","mimeType":"image/png","data":"A/B="}]}',
    };
    // The extra ignored field prevents mirror equality.
    expect((encodeBinaryStorage(original) as typeof original).content).toBe(original.content);
  });
});

describe("corrupt binary storage is an explicit error", () => {
  const corrupted = (mutate: (value: typeof golden.encoded) => void) => {
    const value = structuredClone(golden.encoded);
    mutate(value);
    return value;
  };

  it.each([
    [
      "unknown version",
      (v: typeof golden.encoded) => {
        v.binaryStorage.version = 2;
      },
    ],
    [
      "missing image",
      (v: typeof golden.encoded) => {
        v.binaryStorage.refs[0].image = 50;
      },
    ],
    [
      "non-base64 table data",
      (v: typeof golden.encoded) => {
        v.binaryStorage.data[0] = "中文";
      },
    ],
    [
      "non-null placeholder",
      (v: typeof golden.encoded) => {
        v.toolResult.content[0].data = "unexpected" as unknown as null;
      },
    ],
    [
      "missing path",
      (v: typeof golden.encoded) => {
        v.binaryStorage.refs[0].path = ["absent"];
      },
    ],
    [
      "illegal binary position",
      (v: typeof golden.encoded) => {
        v.binaryStorage.refs[0].path = ["content"];
      },
    ],
    [
      "duplicate ref",
      (v: typeof golden.encoded) => {
        v.binaryStorage.refs.push(v.binaryStorage.refs[0]);
      },
    ],
    [
      "overlapping path",
      (v: typeof golden.encoded) => {
        v.binaryStorage.refs[1].path = ["toolResult"];
      },
    ],
    [
      "invalid escape offset",
      (v: typeof golden.encoded) => {
        const p = v.binaryStorage.texts[0].parts[1];
        if (typeof p !== "string" && p.escapes) p.escapes[0].at = 99;
      },
    ],
    [
      "invalid escape spelling",
      (v: typeof golden.encoded) => {
        const p = v.binaryStorage.texts[0].parts[1];
        if (typeof p !== "string" && p.escapes) p.escapes[0].raw = "\\u0042";
      },
    ],
    [
      "invalid mirror",
      (v: typeof golden.encoded) => {
        v.binaryStorage.texts[0].parts[0] = "{}";
      },
    ],
    [
      "unproven mirror",
      (v: typeof golden.encoded) => {
        v.binaryStorage.texts[0].path = ["metadata", "unused"];
        Object.assign(v.metadata, { unused: null });
      },
    ],
  ])("rejects %s", (_name, mutate) => {
    expect(() => decodeBinaryStorage(corrupted(mutate))).toThrow(/binary storage/i);
  });
});
