// Design-sync bundle shim for the "react/jsx-dev-runtime" specifier — same
// as jsx-runtime.mjs but also provides `jsxDEV`, in case any dependency (or
// a dev-mode plugin-react config) imports the dev runtime instead of the
// production one.
import { Fragment, jsx, jsxs } from "./jsx-runtime.mjs";

export { Fragment, jsx, jsxs };

export function jsxDEV(type, props, key) {
  return props && props.children !== undefined && Array.isArray(props.children)
    ? jsxs(type, props, key)
    : jsx(type, props, key);
}
