/**
 * Strings added by the model drawer (flyout) UX pass: mature-content reveal,
 * overflow menu, tabs, unsaved notes, the current version and prev/next navigation. Merged into the
 * single table in ./index.ts.
 */

export const drawerMessages = {
  'lightbox.showMature': 'Show',
  'lightbox.matureHint': 'Mature content is blurred',
  'detail.moreActions': 'More actions',
  'detail.tabsLabel': 'Model sections',
  'detail.showUpdates': 'Update available, show versions',
  'detail.usageTips': 'Usage tips',
  'detail.useStrength': 'Use strength {value}',
  'detail.unsavedNotes': 'Unsaved changes',
  'detail.discardNotes.title': 'Discard unsaved notes?',
  'detail.discardNotes.message': 'Your changes to the notes of this model have not been saved and will be lost.',
  'detail.discardNotes.confirm': 'Discard',
  'detail.discardNotes.keep': 'Keep editing',
  'detail.current': 'Current',
  'detail.nav.group': 'Browse models',
  'detail.nav.prev': 'Previous model',
  'detail.nav.next': 'Next model',
  'detail.nav.prevHint': 'Previous model (Alt+Left or K)',
  'detail.nav.nextHint': 'Next model (Alt+Right or J)',
  'detail.nav.position': '{position} of {total}',
  'detail.nav.announce': 'Showing {name}, {position}',
  'detail.nav.loadFailed': 'Could not load more models',
} as const
