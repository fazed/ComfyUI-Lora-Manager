<script setup lang="ts">
/**
 * The MooBox LM mark: a cow face in a box. Ears and horns sit on a rounded
 * square head; two eyes and a muzzle with nostrils are cut out of it
 * (even-odd filling). Designed for the companion browser extension
 * (lora-manager-browser-extension: assets/logo-mark.svg, src/lib/logo.ts) on
 * a 12x12 pixel grid; the path is copied verbatim from there (32x32 viewBox,
 * glyph spans 2..30).
 *
 * Always a monochrome currentColor glyph and always decorative: the
 * surrounding element sets the colour (the header tile: on-accent on accent),
 * so every theme colours it through its tokens.
 */
withDefaults(defineProps<{ size?: number }>(), { size: 28 })

const MARK_PATH =
  'M16 7.6H20.667C22.067 5.5 24.4 3.4 28.133 2.467C28.133 5.733 27.2 8.3 25.333 9.933V11.8C27.667 10.867 30 11.8 30 14.133C30 16.467 27.667 17.4 25.333 16.7V26.5Q25.333 30 21.833 30H10.167Q6.667 30 6.667 26.5V16.7C4.333 17.4 2 16.467 2 14.133C2 11.8 4.333 10.867 6.667 11.8V9.933C4.8 8.3 3.867 5.733 3.867 2.467C7.6 3.4 9.933 5.5 11.333 7.6ZM11.8 19.733H20.2Q23 19.733 23 22.533V24.867Q23 27.667 20.2 27.667H11.8Q9 27.667 9 24.867V22.533Q9 19.733 11.8 19.733ZM12.5 21.95C13.272 21.95 13.9 22.734 13.9 23.7C13.9 24.666 13.272 25.45 12.5 25.45C11.728 25.45 11.1 24.666 11.1 23.7C11.1 22.734 11.728 21.95 12.5 21.95ZM19.5 21.95C20.272 21.95 20.9 22.734 20.9 23.7C20.9 24.666 20.272 25.45 19.5 25.45C18.728 25.45 18.1 24.666 18.1 23.7C18.1 22.734 18.728 21.95 19.5 21.95ZM12.5 12.267C13.272 12.267 13.9 12.894 13.9 13.667C13.9 14.439 13.272 15.067 12.5 15.067C11.728 15.067 11.1 14.439 11.1 13.667C11.1 12.894 11.728 12.267 12.5 12.267ZM19.5 12.267C20.272 12.267 20.9 12.894 20.9 13.667C20.9 14.439 20.272 15.067 19.5 15.067C18.728 15.067 18.1 14.439 18.1 13.667C18.1 12.894 18.728 12.267 19.5 12.267Z'
</script>

<template>
  <svg
    class="inline-block flex-none align-middle"
    :width="size"
    :height="size"
    viewBox="0 0 32 32"
    fill="currentColor"
    fill-rule="evenodd"
    aria-hidden="true"
    focusable="false"
  >
    <path :d="MARK_PATH" />
  </svg>
</template>
