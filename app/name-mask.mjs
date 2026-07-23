/**
 * Masks a user-facing display name without changing its identifying prefix.
 * Korean names keep the first and last character; other names hide the last
 * two characters. Applying the function more than once keeps the same result.
 *
 * @param {string} value
 * @returns {string}
 */
export function maskDisplayName(value) {
  const characters = Array.from(value.trim());
  if (!characters.length) return "사용자";
  const hasKorean = characters.some((character) => /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(character));
  if (hasKorean) {
    if (characters.length === 1) return characters[0];
    if (characters.length === 2) return `${characters[0]}*`;
    return `${characters[0]}${"*".repeat(characters.length - 2)}${characters.at(-1)}`;
  }
  if (characters.length <= 2) return "*".repeat(characters.length);
  return `${characters.slice(0, -2).join("")}**`;
}
