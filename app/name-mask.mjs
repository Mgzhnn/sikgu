const anonymousPlaceholder = "사용자";

/**
 * Masks a user-facing display name without changing its identifying prefix.
 * Korean names keep the first and last character; other names keep only the
 * first two characters and hide the rest behind a fixed-width mask so the
 * name's length is not revealed. Applying the function more than once keeps
 * the same result.
 *
 * @param {string} value
 * @returns {string}
 */
export function maskDisplayName(value) {
  const trimmed = value.trim();
  // The placeholder the server substitutes for unusable names is not a name;
  // masking it again would show "사*자" to every viewer.
  if (trimmed === anonymousPlaceholder) return anonymousPlaceholder;
  const characters = Array.from(trimmed);
  if (!characters.length) return anonymousPlaceholder;
  const hasKorean = characters.some((character) => /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(character));
  if (hasKorean) {
    if (characters.length === 1) return characters[0];
    if (characters.length === 2) return `${characters[0]}*`;
    return `${characters[0]}${"*".repeat(characters.length - 2)}${characters.at(-1)}`;
  }
  if (characters.length <= 2) return "*".repeat(characters.length);
  return `${characters.slice(0, 2).join("")}***`;
}
