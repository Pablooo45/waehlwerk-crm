import '@fontsource-variable/atkinson-hyperlegible-next';
import './ui/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { UiProvider } from './ui/ui.tsx';

document.documentElement.lang = 'de';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UiProvider>
      <App />
    </UiProvider>
  </StrictMode>,
);
