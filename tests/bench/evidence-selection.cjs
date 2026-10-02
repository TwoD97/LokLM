/** Pure selection helper; importing it never loads Electron or a model. */
function assertPreparedPlans(prepared) {
  const orderPlans =
    prepared?.kind === 'native-evidence-order-plans' && prepared.cases?.length === 8
  const literalPlans =
    prepared?.kind === 'native-literal-json-plans' &&
    prepared.cases?.length === 3 &&
    prepared.cases.every(
      (entry) =>
        typeof entry.expectedLiteral === 'string' &&
        entry.plan?.jsonSchema?.properties?.quote?.enum?.length === 1 &&
        entry.plan.jsonSchema.properties.quote.enum[0] === entry.expectedLiteral,
    )
  if (
    prepared?.schemaVersion !== 1 ||
    !Array.isArray(prepared.cases) ||
    (!orderPlans && !literalPlans) ||
    !prepared.sourceHashes?.['out/main/modelsWorker.js']
  )
    throw new Error('Expected eight evidence-order plans or three exact literal JSON controls')
}

function selectEvidenceCases(plans, selection) {
  const known = new Map(plans.map((entry) => [`${entry.caseId}/${entry.order}`, entry]))
  if (!known.size || known.size !== plans.length)
    throw new Error('Prepared evidence plans must have unique nonempty case/order identities')
  const selectedCases = selection === undefined ? [...known.keys()] : selection.split(',')
  if (!selectedCases.length || selectedCases.some((id) => !id || !known.has(id)))
    throw new Error('The --cases list must contain known nonempty caseId/order identities')
  if (new Set(selectedCases).size !== selectedCases.length)
    throw new Error('The --cases list must not contain duplicate caseId/order identities')
  const selected = new Set(selectedCases)
  return {
    selectedCases,
    unrequestedCases: [...known.keys()].filter((id) => !selected.has(id)),
    cases: selectedCases.map((id) => known.get(id)),
  }
}

module.exports = { assertPreparedPlans, selectEvidenceCases }
