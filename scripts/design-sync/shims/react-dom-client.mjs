// Design-sync bundle shim for the "react-dom/client" specifier — see
// react.mjs for why this exists. Forwards to `window.ReactDOM`, which
// `_vendor/react.js` builds by merging react-dom + react-dom/client into one
// namespace.
const ReactDOM = window.ReactDOM;

export const createRoot = ReactDOM.createRoot;
export const hydrateRoot = ReactDOM.hydrateRoot;

export default { createRoot, hydrateRoot };
