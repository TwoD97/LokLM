import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'electron-log/renderer'
import { App } from './App'
import './styles.css'
// Bundled offline: KaTeX renders math (remark-math + rehype-katex); highlight.js
// styles code blocks (rehype-highlight). Both ship CSS we load once globally so
// chat answers + document previews + quiz explanations all render consistently.
import 'katex/dist/katex.min.css'
import 'highlight.js/styles/github-dark.css'

const container = document.getElementById('root')
if (!container) throw new Error('Renderer root element #root not found in index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
