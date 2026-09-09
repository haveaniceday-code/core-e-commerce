import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';

/**
 * Punto de montaje. No tiene ramas de negocio y queda excluido de cobertura.
 *
 * El contenedor se comprueba en lugar de afirmarse con `as`: `getElementById` devuelve
 * `HTMLElement | null` y el proyecto prohibe las assertions que silencian al compilador.
 */
const container = document.getElementById('root');
if (container === null) {
  throw new Error('No se encontro el contenedor #root en index.html.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
