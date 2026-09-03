import { inflateSync } from "node:zlib";

const maxReceiptDimension = 2400;
const maxReceiptPixels = 5_760_000;
const maxJpegSegments = 4096;
const maxPngChunks = 4096;
const maxPngImageDataChunks = 1024;

/**
 * @param {Uint8Array} bytes
 * @returns {"image/jpeg" | "image/png" | "image/webp" | null}
 */
export function detectReceiptType(bytes) {
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) return "image/webp";
  return null;
}

/**
 * @param {number} width
 * @param {number} height
 */
function validateReceiptDimensions(width, height) {
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || width < 1
    || height < 1
    || width > maxReceiptDimension
    || height > maxReceiptDimension
    || width * height > maxReceiptPixels
  ) {
    throw new Error("Receipt image dimensions are unsupported.");
  }
}

/**
 * @param {Uint8Array[]} chunks
 */
function joinByteChunks(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined.buffer;
}

const pngCrcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/**
 * @param {Uint8Array} bytes
 * @param {number} start
 * @param {number} end
 */
function pngCrc32(bytes, start, end) {
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset += 1) {
    crc = pngCrcTable[(crc ^ bytes[offset]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Removes JPEG APP/COM metadata and enforces bounded dimensions.
 *
 * @param {Uint8Array} bytes
 */
function sanitizeJpeg(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error("Invalid JPEG receipt.");
  }
  /** @type {Uint8Array[]} */
  const chunks = [bytes.slice(0, 2)];
  let offset = 2;
  let foundDimensions = false;
  let foundScan = false;
  let foundEnd = false;
  let segmentCount = 0;

  while (offset < bytes.length) {
    segmentCount += 1;
    if (segmentCount > maxJpegSegments) throw new Error("JPEG has too many segments.");
    const markerStart = offset;
    if (bytes[offset] !== 0xff) throw new Error("Invalid JPEG marker.");
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) throw new Error("Truncated JPEG marker.");
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0x00 || marker === 0xff) throw new Error("Invalid JPEG marker.");
    if (marker === 0xd9) {
      if (!foundScan) throw new Error("JPEG scan is missing.");
      chunks.push(bytes.slice(markerStart, offset));
      if (offset !== bytes.length) throw new Error("Unexpected JPEG trailing data.");
      foundEnd = true;
      break;
    }
    if (marker === 0xd8) throw new Error("Unexpected JPEG start marker.");
    if (marker >= 0xd0 && marker <= 0xd7) {
      throw new Error("Unexpected JPEG restart marker.");
    }
    if (marker === 0x01) {
      chunks.push(bytes.slice(markerStart, offset));
      continue;
    }
    if (marker < 0xc0) throw new Error("Unsupported JPEG marker.");
    if (offset + 2 > bytes.length) throw new Error("Truncated JPEG segment.");
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    const segmentEnd = offset + segmentLength;
    if (segmentLength < 2 || segmentEnd > bytes.length) {
      throw new Error("Invalid JPEG segment length.");
    }

    const isStartOfFrame = marker >= 0xc0
      && marker <= 0xcf
      && marker !== 0xc4
      && marker !== 0xc8
      && marker !== 0xcc;
    if (isStartOfFrame) {
      if (foundDimensions || segmentLength < 8) throw new Error("Invalid JPEG frame.");
      const dataStart = offset + 2;
      const height = (bytes[dataStart + 1] << 8) | bytes[dataStart + 2];
      const width = (bytes[dataStart + 3] << 8) | bytes[dataStart + 4];
      const componentCount = bytes[dataStart + 5];
      if (
        componentCount < 1
        || componentCount > 4
        || segmentLength !== 8 + (3 * componentCount)
      ) {
        throw new Error("Invalid JPEG frame.");
      }
      validateReceiptDimensions(width, height);
      foundDimensions = true;
    }

    if (marker === 0xdd && segmentLength !== 4) {
      throw new Error("Invalid JPEG restart interval.");
    }
    if (marker === 0xda) {
      if (!foundDimensions || segmentLength < 8) {
        throw new Error("Invalid JPEG scan header.");
      }
      const dataStart = offset + 2;
      const componentCount = bytes[dataStart];
      if (
        componentCount < 1
        || componentCount > 4
        || segmentLength !== 6 + (2 * componentCount)
      ) {
        throw new Error("Invalid JPEG scan header.");
      }
    }

    const isMetadata = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) chunks.push(bytes.slice(markerStart, segmentEnd));
    offset = segmentEnd;

    if (marker === 0xda) {
      const scanStart = offset;
      let nextMarker = -1;
      let foundEntropyData = false;
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) {
          foundEntropyData = true;
          offset += 1;
          continue;
        }
        let markerOffset = offset + 1;
        while (markerOffset < bytes.length && bytes[markerOffset] === 0xff) markerOffset += 1;
        if (markerOffset >= bytes.length) throw new Error("Truncated JPEG scan.");
        const scanMarker = bytes[markerOffset];
        if (scanMarker === 0x00) {
          foundEntropyData = true;
          offset = markerOffset + 1;
          continue;
        }
        if (scanMarker >= 0xd0 && scanMarker <= 0xd7) {
          offset = markerOffset + 1;
          continue;
        }
        nextMarker = offset;
        break;
      }
      if (nextMarker < 0) throw new Error("JPEG end marker is missing.");
      if (!foundEntropyData) throw new Error("JPEG scan data is missing.");
      chunks.push(bytes.slice(scanStart, nextMarker));
      foundScan = true;
      offset = nextMarker;
    }
  }

  if (!foundDimensions || !foundScan || !foundEnd) {
    throw new Error("Incomplete JPEG receipt.");
  }
  return joinByteChunks(chunks);
}

/**
 * Removes PNG text/EXIF/private ancillary chunks and enforces bounded dimensions.
 *
 * @param {Uint8Array} bytes
 */
function sanitizePng(bytes) {
  if (detectReceiptType(bytes) !== "image/png") throw new Error("Invalid PNG receipt.");
  /** @type {Uint8Array[]} */
  const chunks = [bytes.slice(0, 8)];
  const safeAncillaryChunks = new Set(["tRNS"]);
  let offset = 8;
  let foundHeader = false;
  let foundImageData = false;
  let foundEnd = false;
  let endedImageData = false;
  let foundPalette = false;
  let foundTransparency = false;
  let colorType = -1;
  let bitDepth = -1;
  let paletteEntries = 0;
  let imageDataBytes = 0;
  let chunkCount = 0;
  let imageDataChunkCount = 0;

  while (offset < bytes.length) {
    chunkCount += 1;
    if (chunkCount > maxPngChunks) throw new Error("PNG has too many chunks.");
    if (offset + 12 > bytes.length) throw new Error("Truncated PNG chunk.");
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
    const dataLength = view.getUint32(0);
    if (dataLength > bytes.length - offset - 12) {
      throw new Error("Invalid PNG chunk length.");
    }
    const chunkEnd = offset + 12 + dataLength;
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (!/^[A-Za-z]{4}$/.test(type) || !/[A-Z]/.test(type[2])) {
      throw new Error("Invalid PNG chunk type.");
    }
    const expectedCrc = new DataView(
      bytes.buffer,
      bytes.byteOffset + offset + 8 + dataLength,
      4,
    ).getUint32(0);
    const actualCrc = pngCrc32(bytes, offset + 4, offset + 8 + dataLength);
    if (expectedCrc !== actualCrc) throw new Error(`Invalid PNG ${type} CRC.`);
    if (!foundHeader && type !== "IHDR") throw new Error("PNG header must be first.");
    if (foundEnd) throw new Error("Unexpected PNG data after end chunk.");

    if (type === "IHDR") {
      if (foundHeader || offset !== 8 || dataLength !== 13) throw new Error("Invalid PNG header.");
      const header = new DataView(bytes.buffer, bytes.byteOffset + offset + 8, 13);
      validateReceiptDimensions(header.getUint32(0), header.getUint32(4));
      bitDepth = header.getUint8(8);
      colorType = header.getUint8(9);
      const validDepths = {
        0: new Set([1, 2, 4, 8, 16]),
        2: new Set([8, 16]),
        3: new Set([1, 2, 4, 8]),
        4: new Set([8, 16]),
        6: new Set([8, 16]),
      };
      if (
        !validDepths[colorType]?.has(bitDepth)
        || header.getUint8(10) !== 0
        || header.getUint8(11) !== 0
        || header.getUint8(12) !== 0
      ) {
        throw new Error("Unsupported PNG header.");
      }
      foundHeader = true;
    } else if (type === "PLTE") {
      if (
        foundPalette
        || foundImageData
        || colorType === 0
        || colorType === 4
        || dataLength === 0
        || dataLength % 3 !== 0
        || dataLength > 768
      ) {
        throw new Error("Invalid PNG palette.");
      }
      paletteEntries = dataLength / 3;
      if (colorType === 3 && paletteEntries > 2 ** bitDepth) {
        throw new Error("Invalid PNG palette.");
      }
      foundPalette = true;
    } else if (type === "tRNS") {
      const validTransparency = !foundTransparency
        && !foundImageData
        && (
          (colorType === 0 && dataLength === 2)
          || (colorType === 2 && dataLength === 6)
          || (
            colorType === 3
            && foundPalette
            && dataLength > 0
            && dataLength <= paletteEntries
          )
        );
      if (!validTransparency) throw new Error("Invalid PNG transparency.");
      foundTransparency = true;
    } else if (type === "IDAT") {
      imageDataChunkCount += 1;
      if (endedImageData || (colorType === 3 && !foundPalette)) {
        throw new Error("Invalid PNG image data order.");
      }
      if (imageDataChunkCount > maxPngImageDataChunks) {
        throw new Error("PNG has too many image data chunks.");
      }
      foundImageData = true;
      imageDataBytes += dataLength;
    } else if (type === "IEND") {
      if (
        dataLength !== 0
        || !foundImageData
        || imageDataBytes === 0
        || chunkEnd !== bytes.length
      ) {
        throw new Error("Invalid PNG end chunk.");
      }
      foundEnd = true;
    } else if (foundImageData) {
      endedImageData = true;
    }

    const isCritical = type.charCodeAt(0) >= 65 && type.charCodeAt(0) <= 90;
    if (isCritical && !["IHDR", "PLTE", "IDAT", "IEND"].includes(type)) {
      throw new Error(`Unsupported critical PNG chunk: ${type}.`);
    }
    if (isCritical || safeAncillaryChunks.has(type)) {
      chunks.push(bytes.slice(offset, chunkEnd));
    }
    offset = chunkEnd;
    if (type === "IEND") break;
  }

  if (!foundHeader || !foundImageData || !foundEnd) throw new Error("Incomplete PNG receipt.");
  return joinByteChunks(chunks);
}

/**
 * Fully inflates a sanitized non-interlaced PNG and validates its exact scanline
 * length plus every row filter byte. The inflate is capped at the declared
 * pixel byte count, so a decompression bomb costs at most that much memory
 * regardless of how large the stream would expand to.
 *
 * @param {ArrayBuffer} buffer
 */
async function validatePngImageData(buffer) {
  const bytes = new Uint8Array(buffer);
  if (detectReceiptType(bytes) !== "image/png") throw new Error("Invalid PNG receipt.");
  /** @type {Uint8Array[]} */
  const imageData = [];
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  while (offset < bytes.length) {
    const dataLength = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (type === "IHDR") {
      const header = new DataView(bytes.buffer, bytes.byteOffset + offset + 8, 13);
      width = header.getUint32(0);
      height = header.getUint32(4);
      bitDepth = header.getUint8(8);
      colorType = header.getUint8(9);
    } else if (type === "IDAT") {
      imageData.push(bytes.slice(offset + 8, offset + 8 + dataLength));
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + dataLength;
  }
  const channels = new Map([
    [0, 1],
    [2, 3],
    [3, 1],
    [4, 2],
    [6, 4],
  ]).get(colorType);
  if (!width || !height || !channels || !imageData.length) {
    throw new Error("Incomplete PNG image data.");
  }
  const rowBytes = Math.ceil((width * channels * bitDepth) / 8);
  const rowLength = rowBytes + 1;
  const expectedBytes = rowLength * height;
  const compressed = new Uint8Array(joinByteChunks(imageData));
  let inflated;
  try {
    // zlib stops the moment output would exceed maxOutputLength and never
    // allocates past it; the previous streaming decoder buffered ahead of the
    // reader and let a 1 MB bomb reach gigabytes of memory before rejection.
    inflated = inflateSync(compressed, { info: true, maxOutputLength: expectedBytes });
  } catch {
    throw new Error("Invalid PNG compressed image data.");
  }
  if (inflated.engine.bytesWritten !== compressed.byteLength) {
    // Trailing bytes or a second zlib stream after the image data.
    throw new Error("Invalid PNG compressed image data.");
  }
  const raw = inflated.buffer;
  if (raw.byteLength !== expectedBytes) {
    throw new Error("PNG image data does not match its declared dimensions.");
  }
  for (let offset = 0; offset < raw.byteLength; offset += rowLength) {
    if (raw[offset] > 4) throw new Error("Invalid PNG compressed image data: bad row filter.");
  }
}

/**
 * @param {ArrayBuffer} buffer
 * @param {string} contentType
 */
export function sanitizeReceiptImage(buffer, contentType) {
  const bytes = new Uint8Array(buffer);
  if (contentType === "image/jpeg") return sanitizeJpeg(bytes);
  if (contentType === "image/png") return sanitizePng(bytes);
  throw new Error("Unsupported receipt image type.");
}

/**
 * @param {ArrayBuffer} buffer
 * @param {string} contentType
 */
export async function validateReceiptImageData(buffer, contentType) {
  if (contentType !== "image/png") throw new Error("Unsupported receipt image type.");
  await validatePngImageData(buffer);
}
