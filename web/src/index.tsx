import '@xyflow/react/dist/style.css';
import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';

const root = document.querySelector('#app');
if (!(root instanceof HTMLDivElement)) throw new Error('Web root #app is missing.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
