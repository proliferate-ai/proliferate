// Design-sync bundle shim for the "react-dom" specifier — see react.mjs for
// why this exists. Forwards to the single ReactDOM copy `_vendor/react.js`
// installs on `window.ReactDOM` (which also carries the `react-dom/client`
// exports merged in, since the vendor bundle builds both together).
const ReactDOM = window.ReactDOM;

export default ReactDOM;

export const createPortal = ReactDOM.createPortal;
export const flushSync = ReactDOM.flushSync;
export const unstable_batchedUpdates = ReactDOM.unstable_batchedUpdates;
export const findDOMNode = ReactDOM.findDOMNode;
export const version = ReactDOM.version;
