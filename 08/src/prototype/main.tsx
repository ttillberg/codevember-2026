// PROTOTYPE entry, see App.tsx. Not part of the build.
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './proto.css';

createRoot(document.getElementById('root')!).render(<App />);
