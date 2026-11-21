/**
 * Mature-content blur rule shared by the library card, the drawer cover and
 * example thumbnails and the lightbox. Civitai NSFW levels: 1 PG, 2 PG-13,
 * 4 R, 8 X, 16 XXX; from level 4 up the media is blurred while the
 * `blur_mature_content` setting is on (default).
 */
export const MATURE_LEVEL = 4

export function isBlurred(level: number | null | undefined, blurMature: boolean): boolean {
  return blurMature && (level ?? 0) >= MATURE_LEVEL
}
