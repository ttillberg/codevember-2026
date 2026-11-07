import { createRoot } from 'react-dom/client';
import { App } from './App';

// No StrictMode: its double mount races the async WebGPU renderer init.
createRoot(document.getElementById('root')!).render(<App />);
