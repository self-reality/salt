/**
 * Dataset / manifest utilities for the artwork queue.
 */

/**
 * Builds a random sample from the full dataset, validating required fields.
 */
export function buildRandomManifestFromDataset(dataset, sampleSize) {
  const shuffled = dataset.slice();

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }

  const result = [];
  for (const entry of shuffled) {
    if (result.length >= sampleSize) break;
    const item = buildEntryFromDatasetItem(entry);
    if (item) result.push(item);
  }

  return result;
}

/**
 * Extracts the display fields from a raw dataset entry, or returns null if invalid.
 */
export function buildEntryFromDatasetItem(entry) {
  const username = entry?.creator?.username;
  const name = entry?.metadata?.name;
  const width = Number(entry?.metadata?.width);
  const height = Number(entry?.metadata?.height);
  const filename = entry?.metadata?.localFilename;
  if (
    !username
    || !name
    || !filename
    || !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
  ) {
    return null;
  }
  return { username, name, width, height, filename };
}

/**
 * Fuzzy-find an artist in the full dataset by username or full name.
 */
export function findArtistInDataset(dataset, query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return null;
  return (
    dataset.find((e) => String(e?.creator?.username || '').toLowerCase() === q) ||
    dataset.find((e) => String(e?.creator?.fullName || '').toLowerCase() === q) ||
    dataset.find((e) => String(e?.creator?.username || '').toLowerCase().includes(q)) ||
    dataset.find((e) => String(e?.creator?.fullName || '').toLowerCase().includes(q)) ||
    null
  );
}

/**
 * Sorts a manifest into a wave pattern: tallest → widest → tallest for seamless looping.
 * Mutates and returns the array.
 */
export function waveSortManifest(manifest) {
  manifest.sort((a, b) => (b.height / b.width) - (a.height / a.width));

  const sorted = manifest.slice();
  const descHalf = [];
  const ascHalf = [];
  for (let i = 0; i < sorted.length; i++) {
    (i % 2 === 0 ? descHalf : ascHalf).push(sorted[i]);
  }
  ascHalf.reverse();
  manifest.length = 0;
  manifest.push(...descHalf, ...ascHalf);
  return manifest;
}

/**
 * Finds the correct insertion index in a wave-sorted validItems array
 * to maintain the descending-then-ascending aspect-ratio order.
 */
export function insertIndexInWave(validItems, aspectRatio) {
  const n = validItems.length;
  if (n === 0) return 0;

  let splitIndex = n;
  for (let i = 1; i < n; i++) {
    const prevAR = validItems[i - 1]._item.height / validItems[i - 1]._item.width;
    const curAR = validItems[i]._item.height / validItems[i]._item.width;
    if (curAR > prevAR) {
      splitIndex = i;
      break;
    }
  }

  for (let i = 0; i < splitIndex; i++) {
    const ar = validItems[i]._item.height / validItems[i]._item.width;
    if (aspectRatio >= ar) return i;
  }

  for (let i = splitIndex; i < n; i++) {
    const ar = validItems[i]._item.height / validItems[i]._item.width;
    if (aspectRatio <= ar) return i;
  }

  return n;
}
