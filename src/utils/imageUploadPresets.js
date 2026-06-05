export const IMAGE_MIME_WHITELIST = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const imagePresets = {
  avatar: {
    // folder: "uploads/avatars", //Production?
    folder: "avatars", //Development?
    maxBytes: 2 * 1024 * 1024, // 2MB
    maxInputBytes: 6 * 1024 * 1024, // reject huge uploads early (before processing)
    width: 256,
    height: 256,
    fit: "cover", // crop to square
    webp: {
      qualityStart: 82,
      qualityMin: 55,
      qualityStep: 7,
      effort: 4,
    },
  },

  // jokeImage: {
  //   folder: "uploads/jokes",
  //   maxBytes: 4 * 1024 * 1024, // make this higher later if desired
  //   maxInputBytes: 12 * 1024 * 1024,
  //   maxWidth: 1600, // keep detail but prevent gigantic images
  //   fit: "inside", // preserve aspect ratio
  //   webp: {
  //     qualityStart: 84,
  //     qualityMin: 60,
  //     qualityStep: 6,
  //     effort: 4,
  //   },
  // },
};
