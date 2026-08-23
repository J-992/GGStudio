import { readFileSync } from 'node:fs';

/**
 * Reads the pixel dimensions out of a WebP or PNG file header.
 *
 * The shipped art is WebP (see `tools/optimize_assets.sh`), and several tests
 * assert on the real on-disk geometry rather than trusting the config that
 * describes it -- a sprite sheet whose strip is the wrong width animates
 * garbage, and that is worth catching in CI rather than on a phone.
 *
 * WebP is a RIFF container with three different ways of stating the size,
 * and `cwebp` picks between them per file: lossless output is VP8L, plain
 * lossy is VP8, and anything carrying alpha is wrapped as VP8X. All three
 * turn up in `public/assets/`, so all three are handled here.
 */
export function imageSize(path: string): readonly [number, number] {
  const buf = readFileSync(path);

  if (buf.subarray(1, 4).toString('ascii') === 'PNG') {
    return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  }

  if (buf.subarray(0, 4).toString('ascii') !== 'RIFF'
    || buf.subarray(8, 12).toString('ascii') !== 'WEBP') {
    throw new Error(`${path} is neither a PNG nor a WebP`);
  }

  const chunk = buf.subarray(12, 16).toString('ascii');

  // Extended format: the canvas size is stored outright, as two 24-bit
  // little-endian values holding dimension-1.
  if (chunk === 'VP8X') {
    return [buf.readUIntLE(24, 3) + 1, buf.readUIntLE(27, 3) + 1];
  }

  // Lossless: a 0x2f signature byte, then width-1 and height-1 as 14-bit
  // fields packed little-endian across the following four bytes.
  if (chunk === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
  }

  // Lossy: a 3-byte frame tag and the 0x9d012a start code precede two 16-bit
  // little-endian fields whose low 14 bits are the dimensions.
  if (chunk === 'VP8 ') {
    return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
  }

  throw new Error(`${path} has an unsupported WebP chunk: ${chunk}`);
}
