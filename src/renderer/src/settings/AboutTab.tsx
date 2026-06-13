import { useState } from 'react'
import { useT } from '../i18n'

type Notice = {
  name: string
  copyright: string
  license: 'Apache-2.0' | 'MIT' | 'LGPL-3.0-or-later' | 'NVIDIA CUDA EULA'
  source: string
  use: string
}

const NPM_APACHE: Notice[] = [
  {
    name: '@electric-sql/pglite',
    copyright: 'Copyright (c) ElectricSQL and contributors',
    license: 'Apache-2.0',
    source: 'https://github.com/electric-sql/pglite',
    use: 'In-process PostgreSQL via WASM — workspace metadata DB.',
  },
  {
    name: 'drizzle-orm',
    copyright: 'Copyright (c) Drizzle Team and contributors',
    license: 'Apache-2.0',
    source: 'https://github.com/drizzle-team/drizzle-orm',
    use: 'Typed SQL builder + migration runner.',
  },
  {
    name: 'pdf-parse',
    copyright: 'Copyright (c) Modesty Zhang',
    license: 'Apache-2.0',
    source: 'https://gitlab.com/autokent/pdf-parse',
    use: 'PDF text extraction for ingest.',
  },
  {
    name: 'pdfjs-dist',
    copyright: 'Copyright (c) Mozilla Foundation and contributors',
    license: 'Apache-2.0',
    source: 'https://github.com/mozilla/pdf.js',
    use: 'PDF rendering + page-level text extraction fallback.',
  },
  {
    name: 'eld',
    copyright: 'Copyright (c) Nito T.M.',
    license: 'Apache-2.0',
    source: 'https://github.com/nitotm/efficient-language-detector-js',
    use: 'Per-chunk language tagging during ingest.',
  },
  {
    name: 'sharp',
    copyright: 'Copyright (c) Lovell Fuller and contributors',
    license: 'Apache-2.0',
    source: 'https://github.com/lovell/sharp',
    use: 'Image decoding + OCR preprocessing. Bundles libvips (see below).',
  },
  {
    name: 'sherpa-onnx-node',
    copyright: 'Copyright (c) Xiaomi Corporation and k2-fsa contributors',
    license: 'Apache-2.0',
    source: 'https://github.com/k2-fsa/sherpa-onnx',
    use: 'Speaker-diarization runtime.',
  },
  {
    name: 'tesseract.js',
    copyright: 'Copyright (c) Tesseract.js contributors; engine (c) Google and contributors',
    license: 'Apache-2.0',
    source: 'https://github.com/naptha/tesseract.js',
    use: 'OCR for scanned PDFs and ingested images.',
  },
]

const MODELS_APACHE: Notice[] = [
  {
    name: 'Qwen3.5-2B / 4B / 9B (GGUF)',
    copyright: 'Copyright (c) Alibaba Cloud, Qwen Team',
    license: 'Apache-2.0',
    source: 'https://huggingface.co/Qwen',
    use: 'Local LLM — "lite" / "standard" / "pro" tiers.',
  },
  {
    name: 'BGE-reranker-v2-m3 (GGUF)',
    copyright: 'Copyright (c) Beijing Academy of Artificial Intelligence (BAAI)',
    license: 'Apache-2.0',
    source: 'https://huggingface.co/BAAI/bge-reranker-v2-m3',
    use: 'Cross-encoder reranking of retrieved chunks.',
  },
  {
    name: '3D-Speaker ERes2Net (ONNX)',
    copyright: 'Copyright (c) Alibaba, Inc. and its affiliates',
    license: 'Apache-2.0',
    source: 'https://github.com/modelscope/3D-Speaker',
    use: 'Speaker embedding for diarization.',
  },
  {
    name: 'Tesseract traineddata (eng + deu)',
    copyright: 'Copyright (c) Google and Tesseract OCR contributors',
    license: 'Apache-2.0',
    source: 'https://github.com/tesseract-ocr/tessdata_best',
    use: 'OCR language models.',
  },
]

const MODELS_MIT: Notice[] = [
  {
    name: 'BGE-M3 (GGUF)',
    copyright: 'Copyright (c) Beijing Academy of Artificial Intelligence (BAAI)',
    license: 'MIT',
    source: 'https://huggingface.co/BAAI/bge-m3',
    use: 'Workspace embedding.',
  },
  {
    name: 'Whisper (ggml)',
    copyright: 'Copyright (c) OpenAI; ggml conversion by Georgi Gerganov and contributors',
    license: 'MIT',
    source: 'https://huggingface.co/ggerganov/whisper.cpp',
    use: 'Audio transcription.',
  },
  {
    name: 'pyannote segmentation-3.0 (ONNX)',
    copyright: 'Copyright (c) pyannote (Hervé Bredin and contributors)',
    license: 'MIT',
    source: 'https://huggingface.co/pyannote/segmentation-3.0',
    use: 'Speech segmentation for diarization.',
  },
]

const RUNTIME_OTHER: Notice[] = [
  {
    name: 'llama.cpp (via node-llama-cpp)',
    copyright: 'Copyright (c) Georgi Gerganov and contributors',
    license: 'MIT',
    source: 'https://github.com/ggml-org/llama.cpp',
    use: 'LLM inference runtime.',
  },
  {
    name: 'whisper.cpp (via @kutalia/whisper-node-addon)',
    copyright: 'Copyright (c) Georgi Gerganov and contributors',
    license: 'MIT',
    source: 'https://github.com/ggml-org/whisper.cpp',
    use: 'Audio transcription runtime.',
  },
  {
    name: 'libvips (via sharp)',
    copyright: 'Copyright (c) John Cupitt and libvips contributors',
    license: 'LGPL-3.0-or-later',
    source: 'https://github.com/libvips/libvips',
    use: 'Image processing library. Dynamically linked and replaceable, as the LGPL requires; full license text in THIRD_PARTY_NOTICES.md.',
  },
  {
    name: 'Electron / Chromium',
    copyright: 'Copyright (c) Electron contributors / GitHub Inc.',
    license: 'MIT',
    source: 'https://github.com/electron/electron',
    use: 'Application shell. Chromium + ffmpeg licenses ship next to the binary as LICENSES.chromium.html.',
  },
  {
    name: 'NVIDIA CUDA runtime libraries',
    copyright: 'Copyright (c) NVIDIA Corporation',
    license: 'NVIDIA CUDA EULA',
    source: 'https://docs.nvidia.com/cuda/eula/',
    use: 'GPU acceleration (cudart, cuBLAS) — only on CUDA-enabled installs.',
  },
]

const APACHE_LICENSE_URL = 'https://www.apache.org/licenses/LICENSE-2.0'

export function AboutTab(): JSX.Element {
  const t = useT()
  const [openLicense, setOpenLicense] = useState(false)
  const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

  return (
    <div className="settings-about">
      <section className="settings-about__head">
        <div>
          <h2 className="settings-about__title">LokLM</h2>
          <div className="settings-about__meta">
            <span>v{version}</span>
            <span className="settings-about__dot" aria-hidden="true">
              ·
            </span>
            <span>{t('settings.about.licenseMit')}</span>
          </div>
          <p className="settings-about__lede">{t('settings.about.tagline')}</p>
        </div>
      </section>

      <section className="settings-about__section">
        <h3 className="settings-about__h3">{t('settings.about.npmHeading')}</h3>
        <p className="settings-about__sub">{t('settings.about.npmSub')}</p>
        <NoticeList notices={NPM_APACHE} />
      </section>

      <section className="settings-about__section">
        <h3 className="settings-about__h3">{t('settings.about.modelsHeading')}</h3>
        <p className="settings-about__sub">{t('settings.about.modelsSub')}</p>
        <NoticeList notices={MODELS_APACHE} />
        <NoticeList notices={MODELS_MIT} />
      </section>

      <section className="settings-about__section">
        <h3 className="settings-about__h3">{t('settings.about.runtimeHeading')}</h3>
        <p className="settings-about__sub">{t('settings.about.runtimeSub')}</p>
        <NoticeList notices={RUNTIME_OTHER} />
      </section>

      <section className="settings-about__section">
        <button
          className="settings-about__license-toggle"
          onClick={() => setOpenLicense((v) => !v)}
          aria-expanded={openLicense}
        >
          {openLicense ? t('settings.about.hideApacheText') : t('settings.about.showApacheText')}
        </button>
        {openLicense && (
          <p className="settings-about__sub">
            {t('settings.about.apacheNote')}{' '}
            <a href={APACHE_LICENSE_URL} target="_blank" rel="noreferrer noopener">
              {APACHE_LICENSE_URL}
            </a>
          </p>
        )}
      </section>

      <section className="settings-about__section">
        <h3 className="settings-about__h3">{t('settings.about.logsHeading')}</h3>
        <p className="settings-about__sub">{t('settings.about.logsSub')}</p>
        <button
          className="settings-about__license-toggle"
          onClick={() => {
            void window.api.logs.openFolder()
          }}
        >
          {t('settings.about.logsOpen')}
        </button>
      </section>
    </div>
  )
}

function NoticeList({ notices }: { notices: Notice[] }): JSX.Element {
  return (
    <ul className="settings-about__list">
      {notices.map((n) => (
        <li key={n.name} className="settings-about__item">
          <div className="settings-about__item-head">
            <span className="settings-about__item-name">{n.name}</span>
            <span className="settings-about__item-license">{n.license}</span>
          </div>
          <div className="settings-about__item-copy">{n.copyright}</div>
          <div className="settings-about__item-use">{n.use}</div>
          <a
            className="settings-about__item-link"
            href={n.source}
            target="_blank"
            rel="noreferrer noopener"
          >
            {n.source}
          </a>
        </li>
      ))}
    </ul>
  )
}
