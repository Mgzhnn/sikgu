const anonymousPlaceholder = "사용자";
// The server's fallback for an account without a profile name: six hex
// characters of the email hash are the only thing telling two such accounts
// apart, so the placeholder must pass through unmasked.
const generatedPlaceholder = /^User-[0-9A-F]{6}$/;

/**
 * Masks a user-facing display name without changing its identifying prefix.
 * Korean names keep the first and last character; other names keep the first
 * word and reduce every later word to an initial ("Jonathan Smith" reads
 * "Jonathan S."). Two leading letters plus a fixed mask made every "Jo…"
 * identical in a host's approval list, which is where the name has to tell
 * people apart. Applying the function more than once keeps the same result.
 *
 * @param {string} value
 * @returns {string}
 */
export function maskDisplayName(value) {
  const trimmed = value.trim();
  // The placeholder the server substitutes for unusable names is not a name;
  // masking it again would show "사*자" to every viewer.
  if (trimmed === anonymousPlaceholder) return anonymousPlaceholder;
  if (generatedPlaceholder.test(trimmed)) return trimmed;
  const characters = Array.from(trimmed);
  if (!characters.length) return anonymousPlaceholder;
  const hasKorean = characters.some((character) => /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(character));
  if (hasKorean) {
    if (characters.length === 1) return characters[0];
    if (characters.length === 2) return `${characters[0]}*`;
    return `${characters[0]}${"*".repeat(characters.length - 2)}${characters.at(-1)}`;
  }
  const words = trimmed.split(/\s+/);
  if (words.length === 1) return words[0];
  const initials = words.slice(1).map((word) => `${Array.from(word)[0]}.`).join(" ");
  return `${words[0]} ${initials}`;
}
