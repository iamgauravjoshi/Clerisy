import { createRoot } from 'react-dom/client'
import { App } from './App'
import { hasBridge, NoBridge } from './NoBridge'
import './styles/index.css'

createRoot(document.getElementById('root')!).render(hasBridge() ? <App /> : <NoBridge />)
