// Astro provides this virtual module during builds. Endpoint unit tests mock
// its collection boundary while exercising the real response/route builders.
export function getCollection(): never {
  throw new Error('The endpoint test must provide its content collection fixture.')
}
