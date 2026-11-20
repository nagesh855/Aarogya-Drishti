import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { LocalizationProvider } from './i18n.js';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <LocalizationProvider>
    <App />
  </LocalizationProvider>
);
