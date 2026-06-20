import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Compound design tokens — CSS custom properties for color, spacing, typography,
// plus automatic light/dark theming via prefers-color-scheme. Imported once here
// so every Compound component (and our own CSS using cpd-* vars) inherits them.
import '@vector-im/compound-design-tokens/assets/web/css/compound-design-tokens.css'

// Fonts Compound expects: Inter (UI) and Inconsolata (monospace). Only the
// weights we actually use, to keep the bundle lean.
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/inconsolata/400.css'

import './index.css'
import App from './App.tsx'
import { ClientProvider } from './client/ClientContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClientProvider>
      <App />
    </ClientProvider>
  </StrictMode>,
)
