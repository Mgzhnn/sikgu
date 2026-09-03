export const deliveryAppIds = Object.freeze(["baemin", "coupang"]);

export const restaurantMinimums = Object.freeze({
  sinjeon: Object.freeze({ baemin: 15000, coupang: 18000 }),
  mom: Object.freeze({ baemin: 14000, coupang: 16000 }),
  hongkong: Object.freeze({ baemin: 16000, coupang: 14000 }),
  kyochon: Object.freeze({ baemin: 18000, coupang: 20000 }),
  dosirak: Object.freeze({ baemin: 12000, coupang: 13000 }),
  sushi: Object.freeze({ baemin: 18000, coupang: 15000 }),
  mykatsu: Object.freeze({ baemin: 13000, coupang: 15000 }),
  subway: Object.freeze({ baemin: 12000, coupang: 14000 }),
  stella: Object.freeze({ baemin: 14000, coupang: 15000 }),
  yup: Object.freeze({ baemin: 15000, coupang: 17000 }),
  domino: Object.freeze({ baemin: 18000, coupang: 20000 }),
  youngpizza: Object.freeze({ baemin: 17000, coupang: 18000 }),
  pizzahut: Object.freeze({ baemin: 18000, coupang: 18000 }),
  bbq: Object.freeze({ baemin: 19000, coupang: 20000 }),
  hosigi: Object.freeze({ baemin: 20000, coupang: 21000 }),
  ogburger: Object.freeze({ baemin: 14000, coupang: 15000 }),
  bonjuk: Object.freeze({ baemin: 13000, coupang: 15000 }),
  agu: Object.freeze({ baemin: 22000, coupang: 23000 }),
  dakguksu: Object.freeze({ baemin: 15000, coupang: 16000 }),
  kimchijjim: Object.freeze({ baemin: 16000, coupang: 17000 }),
  cozy: Object.freeze({ baemin: 18000, coupang: 20000 }),
});

export const pickupFullNames = Object.freeze({
  E1: "E1 연구동 정문",
  E2: "E2 택배보관함",
  E3: "E3 택배보관함",
  E4: "E4 택배보관함",
  E5: "E5 택배보관함",
  E6: "E6 택배보관함",
  "201·202": "201-204 사이 택배 수령장소",
  대학원: "비슬빌리지 206동 택배 수령장소",
});

export const roomDurations = Object.freeze([20, 30, 45]);
export const roomCapacities = Object.freeze([2, 3, 4, 5, 6, 7, 8]);
export const maxChatMessageCharacters = 1000;
export const maxRoomNoteCharacters = 300;
export const maxDisplayNameCharacters = 40;

/**
 * Keep only supported delivery apps and remove duplicates.
 *
 * @param {unknown} value
 * @returns {Array<"baemin" | "coupang">}
 */
export function parseDeliveryApps(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => deliveryAppIds.includes(item)))];
}

/**
 * @param {unknown} value
 * @returns {value is keyof typeof restaurantMinimums}
 */
export function isRestaurantId(value) {
  return typeof value === "string" && Object.hasOwn(restaurantMinimums, value);
}

/**
 * @param {unknown} value
 * @returns {value is keyof typeof pickupFullNames}
 */
export function isPickupId(value) {
  return typeof value === "string" && Object.hasOwn(pickupFullNames, value);
}

// Removed from free text: C0/C1 controls except tab, newline, and carriage
// return; every Unicode format character (bidi overrides and isolates, zero
// width space, word joiner, deprecated and interlinear controls, soft hyphen)
// except the joiners, bidi marks, and tag characters listed below, which are
// harmless alone and needed inside real text (emoji sequences, Persian and
// Indic words, subdivision flags); and the Hangul fillers, which are letters
// that render as nothing.
const disallowedTextCharacters =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u115F\u1160\u3164\uFFA0]|(?![\u200C-\u200F\u061C\u{E0000}-\u{E007F}])\p{Cf}/gu;

// Text that renders as nothing when this is all there is: whitespace,
// combining marks with no base, braille blank, variation selectors, joiners,
// bidi marks, tag characters.
const blankCharacters =
  /^(?:[\s\p{M}\u2800\uFE00-\uFE0F\u200C-\u200F\u061C]|[\u{E0000}-\u{E007F}]|[\u{E0100}-\u{E01EF}])*$/u;

/**
 * Normalizes user-entered free text (room notes, chat messages, display
 * names): only strings are accepted, NFC-normalized, control and format
 * characters removed, line endings unified, trimmed, and truncated by code
 * point so an emoji is never cut in half. Returns "" for anything that has no
 * visible character.
 *
 * @param {unknown} value
 * @param {number} maxCharacters
 * @returns {string}
 */
export function cleanText(value, maxCharacters) {
  if (typeof value !== "string") return "";
  const normalized = value
    .normalize("NFC")
    .replace(disallowedTextCharacters, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!normalized || blankCharacters.test(normalized)) return "";
  return Array.from(normalized).slice(0, maxCharacters).join("");
}
