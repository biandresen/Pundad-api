/**
 * Normalizes tags from input: trims and converts to lowercase.
 *
 * @param {string|string[]} tags - Comma or space/plus-separated string or array of tags.
 * @returns {string[]} Array of normalized tags.
 */

function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return tags.map((t) => t.trim().toLowerCase()); // if tags are already an array, like when creating a joke with tags
  }

  const containsComma = tags.includes(",");

  //correct in url endpoints for queries: tag=tag,tag or tag=tag+tag
  const splitTags = containsComma ? tags.split(",") : tags.split(" ");

  return splitTags.map((t) => t.trim().toLowerCase());
}

export default normalizeTags;
