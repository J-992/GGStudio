/**
 * A zero-dependency PNG box-downsampler.
 *
 * The source packs ship every colour map at 2048x2048: six cat skins and five
 * townhouse finishes, 52 MB of PNG between them and 176 MB of texture memory
 * once decoded. Nothing in this game is ever seen close enough to resolve that -
 * the cat is roughly 90 px tall on screen at the follow camera's distance - so
 * the maps are halved to 1024 on the way into `public/assets/`, which is the
 * only place the cost can actually be removed. Doing it at runtime would mean
 * paying the download and the full-size decode first and then paying again to
 * resample.
 *
 * Deliberately narrow: 8-bit non-interlaced truecolour (with or without alpha),
 * which is what every map in these archives is. Anything else throws, and the
 * caller ships the original rather than a corrupted one - a texture that is
 * bigger than it needs to be is a performance note, a texture that is wrong is
 * a bug.
 */

import { inflateSync, deflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Channel count per PNG colour type. Only the two truecolour forms are handled. */
const CHANNELS = { 2: 3, 6: 4 };

// ---------------------------------------------------------------------------
// CRC-32, as PNG specifies it (IEEE 802.3, reflected)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Splits a PNG into its chunks, concatenating the IDAT run. */
function readChunks(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');

  let header = null;
  const idat = [];
  let ptr = 8;

  while (ptr + 8 <= buf.length) {
    const length = buf.readUInt32BE(ptr);
    const type = buf.toString('latin1', ptr + 4, ptr + 8);
    const data = buf.subarray(ptr + 8, ptr + 8 + length);

    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }

    ptr += 12 + length; // length + type + data + crc
  }

  if (!header) throw new Error('PNG has no IHDR');
  return { header, idat: Buffer.concat(idat) };
}

/** Paeth predictor, byte-for-byte as the spec defines it. */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Reverses the per-scanline filters, producing a flat pixel buffer.
 *
 * Each scanline is prefixed with its filter byte and every predictor refers to
 * the *reconstructed* bytes to its left and above, so this has to run in order
 * and in place.
 */
function unfilter(raw, width, height, channels) {
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const up = dst - stride;

    for (let x = 0; x < stride; x++) {
      const value = raw[src + x];
      const left = x >= channels ? out[dst + x - channels] : 0;
      const above = y > 0 ? out[up + x] : 0;
      const upLeft = y > 0 && x >= channels ? out[up + x - channels] : 0;

      let recon;
      switch (filter) {
        case 0: recon = value; break;
        case 1: recon = value + left; break;
        case 2: recon = value + above; break;
        case 3: recon = value + ((left + above) >> 1); break;
        case 4: recon = value + paeth(left, above, upLeft); break;
        default: throw new Error(`unknown PNG filter ${filter} on row ${y}`);
      }
      out[dst + x] = recon & 0xff;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Resample
// ---------------------------------------------------------------------------

/**
 * Averages each `factor`x`factor` block down to one pixel.
 *
 * A box filter rather than point sampling: these are photographic-ish colour
 * maps, and dropping three of every four pixels puts aliasing into exactly the
 * high-frequency brick and fur detail the map exists for. Integer factors only,
 * which is all a power-of-two source needs.
 */
function boxDownsample(pixels, width, height, channels, factor) {
  const outWidth = Math.floor(width / factor);
  const outHeight = Math.floor(height / factor);
  const out = Buffer.alloc(outWidth * outHeight * channels);
  const samples = factor * factor;

  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      for (let c = 0; c < channels; c++) {
        let total = 0;
        for (let dy = 0; dy < factor; dy++) {
          const row = (y * factor + dy) * width * channels;
          for (let dx = 0; dx < factor; dx++) {
            total += pixels[row + (x * factor + dx) * channels + c];
          }
        }
        out[(y * outWidth + x) * channels + c] = Math.round(total / samples);
      }
    }
  }

  return { pixels: out, width: outWidth, height: outHeight };
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * Writes a PNG with every scanline unfiltered.
 *
 * Filter selection is where a real encoder earns its compression, but these are
 * downsampled colour maps that end up around a megabyte either way, and the
 * point of this module is to be obviously correct rather than to be libpng.
 */
function encode(pixels, width, height, colorType, channels) {
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------

/**
 * Downsamples a PNG so its longest side is at most `maxSize`.
 *
 * Returns the original buffer untouched when it is already small enough or when
 * the reduction would not be a whole number of pixels.
 *
 * @param {Buffer} buffer a complete PNG file
 * @param {number} maxSize longest permitted side, in pixels
 * @returns {{ data: Buffer, width: number, height: number, resized: boolean }}
 */
export function downsamplePng(buffer, maxSize) {
  const { header, idat } = readChunks(buffer);

  if (header.interlace !== 0) throw new Error('interlaced PNG is not supported');
  if (header.depth !== 8) throw new Error(`unsupported bit depth ${header.depth}`);

  const channels = CHANNELS[header.colorType];
  if (!channels) throw new Error(`unsupported colour type ${header.colorType}`);

  const longest = Math.max(header.width, header.height);
  const factor = Math.floor(longest / maxSize);
  if (factor < 2 || header.width % factor !== 0 || header.height % factor !== 0) {
    return { data: buffer, width: header.width, height: header.height, resized: false };
  }

  const pixels = unfilter(
    inflateSync(idat),
    header.width,
    header.height,
    channels,
  );
  const small = boxDownsample(pixels, header.width, header.height, channels, factor);

  return {
    data: encode(small.pixels, small.width, small.height, header.colorType, channels),
    width: small.width,
    height: small.height,
    resized: true,
  };
}
