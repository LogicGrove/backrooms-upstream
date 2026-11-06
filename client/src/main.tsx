import { createRoot } from 'react-dom/client';
import './game/backrooms.css';
import App from './App';

// desarrollo: /?grips abre la herramienta para colocar los objetos en las manos (dev/GripTool.tsx)
if (import.meta.env.DEV && new URLSearchParams(location.search).has('grips')) {
  import('./dev/GripTool').then(({ default: GripTool }) => createRoot(document.getElementById('root')!).render(<GripTool />));
} else createRoot(document.getElementById('root')!).render(<App />);
