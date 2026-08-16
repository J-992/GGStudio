/**
 * Stamp a content hash onto a `public/assets` URL.
 *
 * These files ship verbatim, so their paths never change between deploys and a
 * CDN has no way to tell a stale copy from a current one. The deploy used to
 * answer that by revalidating every one of them — correct, but it meant an
 * arena load spent about a hundred round trips asking whether files it already
 * had were still good, right when the player was waiting on it.
 *
 * A build-time hash in the query string moves that decision to the URL: content
 * changes, URL changes, so the response can be `immutable` and the second visit
 * asks nothing. `vercel.json` grants that only to the extensions that always
 * come through here — an asset reached by some other route must keep
 * revalidating, or a stale one would be cached for a year.
 */

import manifest from 'virtual:asset-manifest';

const ASSET_PREFIX = `${import.meta.env.BASE_URL}assets/`;

/**
 * Add `?v=<hash>` to a URL under `public/assets`.
 *
 * Anything unrecognised is returned untouched: a URL outside the asset root, or
 * one naming a file the manifest has never heard of (a stray reference, or a
 * dev server running against freshly written art). An un-versioned URL is
 * always safe — it just revalidates, which is what everything used to do.
 */
export function assetUrl(url: string): string {
  if (!url.startsWith(ASSET_PREFIX)) return url;
  // Query and fragment are not part of an asset's identity here, and no caller
  // currently passes one; splitting keeps a future one from corrupting the key.
  const [pathname] = url.slice(ASSET_PREFIX.length).split(/[?#]/);
  const hash = manifest[pathname];
  return hash === undefined ? url : `${url}?v=${hash}`;
}
