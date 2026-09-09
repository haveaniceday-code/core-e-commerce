import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';

// Hoja de estilos global. Se importa aqui —y no en `App`— porque es infraestructura de
// arranque, no parte de la composicion: los tests montan `App` sin necesitar el CSS.
import './styles.css';

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
