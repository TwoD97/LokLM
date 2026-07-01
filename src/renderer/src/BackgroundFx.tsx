/**
 * fixed-position layer behind everything , four big soft gradient blobs. the
 * auth-card sits on top with backdrop-filter and picks up these colours
 * through the glass. purely decorative.
 *
 * Fully static on purpose. The original drifted the blobs on infinite CSS
 * keyframes with a giant filter: blur() plus a cursor parallax — that forced
 * the compositor to redraw the whole window at display refresh rate and ate
 * most of a laptop iGPU while the app sat idle. The soft falloff is baked
 * into the radial gradients now (see styles.css), so the layer paints once
 * and costs nothing afterwards.
 */
export function BackgroundFx(): JSX.Element {
  return (
    <div className="bgfx" aria-hidden="true" role="presentation">
      <span className="bgfx__blob bgfx__blob--1" />
      <span className="bgfx__blob bgfx__blob--2" />
      <span className="bgfx__blob bgfx__blob--3" />
      <span className="bgfx__blob bgfx__blob--4" />
      <span className="bgfx__grain" />
    </div>
  )
}
