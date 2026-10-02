# Darsen decoder release package copy B
Both the archive label and release metadata identify release 2.1.0. The exported function is:

~~~ts
export function clampSlots(requested: number): number {
  return Math.min(10, Math.max(0, requested))
}
~~~

This archival copy contains no deployment receipt or record choosing between package copies.
