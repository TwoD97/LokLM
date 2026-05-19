import { FixedSizeChunker, type Chunker } from './Chunker'
import { FakeEmbedder, type Embedder } from './Embedder'
import { NoopReranker, type Reranker } from './Reranker'

// eine config ist ein bundle aus chunker + embedder + reranker mit einem
// stabilen namen. der runner iteriert genau über diese liste.
// neue varianten einfach hier eintragen.

export interface PipelineConfig {
  name: string
  chunker: Chunker
  embedder: Embedder
  reranker: Reranker
}

export function defaultConfigs(): PipelineConfig[] {
  return [
    {
      name: 'fake-256-noop',
      chunker: new FixedSizeChunker({ name: 'fixed-256-32', size: 256, overlap: 32 }),
      embedder: new FakeEmbedder(64),
      reranker: new NoopReranker(),
    },
    {
      name: 'fake-512-noop',
      chunker: new FixedSizeChunker({ name: 'fixed-512-64', size: 512, overlap: 64 }),
      embedder: new FakeEmbedder(64),
      reranker: new NoopReranker(),
    },
    // weitere configs hier eintragen sobald reale embedders / rerankers existieren:
    //
    // {
    //   name: 'bge-small-512-rerank',
    //   chunker: new FixedSizeChunker({ name: 'fixed-512-64' , size: 512 , overlap: 64 }) ,
    //   embedder: new BgeSmallEnEmbedder() ,
    //   reranker: new BgeRerankerBase() ,
    // } ,
  ]
}
