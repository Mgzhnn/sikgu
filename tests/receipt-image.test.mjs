import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";
import {
  detectReceiptType,
  sanitizeReceiptImage,
  validateReceiptImageData,
} from "../app/receipt-image.mjs";

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function bytes(...parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function uint32(value) {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = []) {
  const typeBytes = [...new TextEncoder().encode(type)];
  const checksum = crc32([...typeBytes, ...data]);
  return [
    ...uint32(data.length),
    ...typeBytes,
    ...data,
    ...uint32(checksum),
  ];
}

function pngFixture(width, height, ancillaryChunks = []) {
  const rawPixels = width * height <= 1_000_000
    ? new Uint8Array((width * 3 + 1) * height)
    : new Uint8Array([0, 0, 0, 0]);
  return bytes(
    pngSignature,
    pngChunk("IHDR", [
      ...uint32(width),
      ...uint32(height),
      8,
      2,
      0,
      0,
      0,
    ]),
    ...ancillaryChunks,
    pngChunk("IDAT", [...deflateSync(rawPixels)]),
    pngChunk("IEND"),
  );
}

function pngChunkTypes(buffer) {
  const source = new Uint8Array(buffer);
  const types = [];
  let offset = pngSignature.length;
  while (offset < source.length) {
    const length = new DataView(source.buffer, source.byteOffset + offset, 4).getUint32(0);
    types.push(String.fromCharCode(...source.slice(offset + 4, offset + 8)));
    offset += 12 + length;
  }
  return types;
}

test("PNG sanitization strips text and EXIF chunks while retaining safe transparency", () => {
  const input = pngFixture(320, 240, [
    pngChunk("tEXt", [...new TextEncoder().encode("address=secret")]),
    pngChunk("eXIf", [1, 2, 3, 4]),
    pngChunk("tRNS", [0, 0, 0, 0, 0, 0]),
  ]);

  assert.equal(detectReceiptType(input), "image/png");
  const sanitized = sanitizeReceiptImage(input.buffer, "image/png");

  assert.deepEqual(pngChunkTypes(sanitized), ["IHDR", "tRNS", "IDAT", "IEND"]);
  assert.ok(sanitized.byteLength < input.byteLength);
});

test("PNG pixel validation inflates the exact declared scanlines", async () => {
  const input = pngFixture(32, 24);
  const sanitized = sanitizeReceiptImage(input.buffer, "image/png");

  await assert.doesNotReject(
    validateReceiptImageData(sanitized, "image/png"),
  );
});

test("PNG pixel validation rejects invalid deflate data and row filters", async () => {
  const invalidDeflate = bytes(
    pngSignature,
    pngChunk("IHDR", [...uint32(1), ...uint32(1), 8, 2, 0, 0, 0]),
    pngChunk("IDAT", [1, 2, 3, 4]),
    pngChunk("IEND"),
  );
  const badFilter = bytes(
    pngSignature,
    pngChunk("IHDR", [...uint32(1), ...uint32(1), 8, 2, 0, 0, 0]),
    pngChunk("IDAT", [...deflateSync(new Uint8Array([5, 0, 0, 0]))]),
    pngChunk("IEND"),
  );

  await assert.rejects(
    validateReceiptImageData(
      sanitizeReceiptImage(invalidDeflate.buffer, "image/png"),
      "image/png",
    ),
    /Invalid PNG compressed image data/,
  );
  await assert.rejects(
    validateReceiptImageData(
      sanitizeReceiptImage(badFilter.buffer, "image/png"),
      "image/png",
    ),
    /Invalid PNG compressed image data/,
  );
});

test("PNG sanitization rejects a chunk with a bad CRC", () => {
  const input = pngFixture(16, 16);
  const corrupted = input.slice();
  const ihdrCrcOffset = pngSignature.length + 8 + 13;
  corrupted[ihdrCrcOffset] ^= 0x01;

  assert.throws(
    () => sanitizeReceiptImage(corrupted.buffer, "image/png"),
    /Invalid PNG IHDR CRC/,
  );
});

test("PNG sanitization rejects nonconsecutive image data chunks", () => {
  const rawPixels = new Uint8Array((8 * 3 + 1) * 8);
  const compressed = [...deflateSync(rawPixels)];
  const splitAt = Math.ceil(compressed.length / 2);
  const input = bytes(
    pngSignature,
    pngChunk("IHDR", [
      ...uint32(8),
      ...uint32(8),
      8,
      2,
      0,
      0,
      0,
    ]),
    pngChunk("IDAT", compressed.slice(0, splitAt)),
    pngChunk("tEXt", [...new TextEncoder().encode("note")]),
    pngChunk("IDAT", compressed.slice(splitAt)),
    pngChunk("IEND"),
  );

  assert.throws(
    () => sanitizeReceiptImage(input.buffer, "image/png"),
    /Invalid PNG image data order/,
  );
});

test("PNG sanitization rejects excessive pixel counts", () => {
  const input = pngFixture(2401, 2400);
  assert.throws(
    () => sanitizeReceiptImage(input.buffer, "image/png"),
    /Receipt image dimensions are unsupported/,
  );
});

test("PNG pixel validation never inflates past the declared size, so a decompression bomb cannot exhaust memory", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/receipt-image.mjs", import.meta.url), "utf8");
  const validator = source.slice(source.indexOf("async function validatePngImageData"), source.indexOf("export function sanitizeReceiptImage"));

  // Structural guard: the inflate must be capped at the declared byte count
  // (zlib stops allocating at maxOutputLength) instead of streaming through
  // DecompressionStream, which buffers ahead of a slow reader.
  assert.match(source, /from "node:zlib"/);
  assert.match(validator, /inflateSync\([\s\S]*maxOutputLength: expectedBytes/);
  assert.doesNotMatch(validator, /DecompressionStream/);

  // Behavioral guard: a 1x1 RGB image whose IDAT inflates to 64 MiB declares
  // 4 bytes of pixel data. It must be rejected without inflating the whole
  // stream, which a capped inflate does in a few milliseconds.
  const bomb = bytes(
    pngSignature,
    pngChunk("IHDR", [...uint32(1), ...uint32(1), 8, 2, 0, 0, 0]),
    pngChunk("IDAT", [...deflateSync(new Uint8Array(64 * 1024 * 1024), { level: 9 })]),
    pngChunk("IEND"),
  );
  const sanitized = sanitizeReceiptImage(bomb.buffer, "image/png");
  const started = performance.now();
  await assert.rejects(validateReceiptImageData(sanitized, "image/png"), /Invalid PNG compressed image data/);
  assert.ok(performance.now() - started < 250, `bomb rejection took ${Math.round(performance.now() - started)} ms`);
});

test("PNG pixel validation rejects trailing bytes and concatenated zlib streams after the image data", async () => {
  const width = 2;
  const height = 2;
  const rows = new Uint8Array((width * 3 + 1) * height);
  const clean = [...deflateSync(rows)];
  for (const [label, idat] of [
    ["trailing junk", [...clean, 1, 2, 3]],
    ["concatenated stream", [...clean, ...clean]],
  ]) {
    const input = bytes(
      pngSignature,
      pngChunk("IHDR", [...uint32(width), ...uint32(height), 8, 2, 0, 0, 0]),
      pngChunk("IDAT", idat),
      pngChunk("IEND"),
    );
    await assert.rejects(
      validateReceiptImageData(sanitizeReceiptImage(input.buffer, "image/png"), "image/png"),
      /Invalid PNG compressed image data/,
      label,
    );
  }
});

test("16-bit PNGs are refused so the largest accepted image inflates to at most 23 MB", () => {
  // The browser re-encodes every receipt through a canvas, which only produces
  // 8-bit PNGs; a hand-crafted 16-bit RGBA 2400x2400 upload would inflate to
  // 46 MB, and the end-to-end request then sat within a few MB of the Workers
  // memory cap.
  for (const [colorType, depth] of [[0, 16], [2, 16], [4, 16], [6, 16]]) {
    const input = bytes(
      pngSignature,
      pngChunk("IHDR", [...uint32(2), ...uint32(2), depth, colorType, 0, 0, 0]),
      pngChunk("IDAT", [...deflateSync(new Uint8Array(4))]),
      pngChunk("IEND"),
    );
    assert.throws(() => sanitizeReceiptImage(input.buffer, "image/png"), /Unsupported PNG header/, `color type ${colorType} depth 16`);
  }
  const eightBit = pngFixture(2, 2);
  assert.doesNotThrow(() => sanitizeReceiptImage(eightBit.buffer, "image/png"));
});
