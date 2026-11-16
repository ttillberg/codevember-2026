import { createRoot } from 'react-dom/client';
import { App } from './App';
import './style.css';

// ?clean: no page furniture, the scene alone (screengrabs, clips)
if (new URLSearchParams(location.search).has('clean')) document.body.classList.add('clean');

createRoot(document.getElementById('root')!).render(<App />);
