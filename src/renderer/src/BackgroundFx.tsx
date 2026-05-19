/**
 * fixed-position layer behind everything , four big heavily-blurred gradient
 * blobs that drift on long offset CSS keyframe loops. the auth-card sits on
 * top with backdrop-filter and picks up these colours through the glass.
 * purely decorative , `prefers-reduced-motion` kills the animation via the
 * global rule in styles.css.
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
