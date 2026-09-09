import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const root = document.getElementById('root');
if (root === null) throw new Error('PlanRepo root를 찾지 못했습니다.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
