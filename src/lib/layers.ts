// Where popovers, menus, and dialogs mount. The app frame is its own stacking context, so they
// mount in its layer element to stack with its sticky header (app-frame.tsx): the page's
// popovers and menus under the header, the header's menus and dialogs over it. Outside the
// frame they mount in the body.
export const LAYERS_ID = 'app-layers'

export function layerRoot() {
  return (typeof document !== 'undefined' && document.getElementById(LAYERS_ID)) || undefined
}
