import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/assistant'
import '@fontsource/ibm-plex-mono/500.css'
import './index.css'
import { App } from './app/App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
