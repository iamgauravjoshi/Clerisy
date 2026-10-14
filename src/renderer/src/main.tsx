import { createRoot } from 'react-dom/client'
import { App } from './App'
import { hasBridge, NoBridge } from './NoBridge'
import { WidgetPage } from './pages/WidgetPage'
import './styles/index.css'

// the floating meeting widget loads the same page with #widget (main/widget.ts)
const page = window.location.hash === '#widget' ? <WidgetPage /> : <App />
createRoot(document.getElementById('root')!).render(hasBridge() ? page : <NoBridge />)
