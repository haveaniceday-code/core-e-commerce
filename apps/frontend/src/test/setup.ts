/**
 * Setup global de la Suite_Frontend (FC-R6.1).
 *
 * Registra los matchers de `@testing-library/jest-dom` en el `expect` de Vitest, de modo
 * que los specs puedan afirmar sobre el DOM (`toBeInTheDocument`, `toHaveTextContent`) en
 * lugar de inspeccionar nodos a mano. Se carga una sola vez, desde `setupFiles`.
 */
import '@testing-library/jest-dom/vitest';
