import { createRequire } from 'node:module'

export interface BuildProvenanceEvidence {
  status: 'matched' | 'unknown'
  reason: string
  currentSourcesMatchBuild?: boolean
  changedCurrentSourcePaths?: string[]
  sourceHashesAtBuild?: Record<string, string>
  compiledHashesAtBuild?: Record<string, string>
  [key: string]: unknown
}

const { verifyBuildProvenance } = createRequire(import.meta.url)(
  '../../bench/build-provenance.cjs',
) as {
  verifyBuildProvenance(root?: string): Promise<BuildProvenanceEvidence>
}

/** Missing/stale historical manifests are unknown, never retroactively inferred. */
export const inspectBuildProvenance = verifyBuildProvenance
