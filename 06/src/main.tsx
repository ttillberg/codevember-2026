import { createRoot } from 'react-dom/client';
import { App } from './App';

// No StrictMode: its double mount races drei's <Html> roots under React 19.
createRoot(document.getElementById('root')!).render(<App />);
