// Design-sync bundle shim for the "react/jsx-runtime" specifier. The
// automatic JSX runtime (@vitejs/plugin-react's default) imports `jsx`,
// `jsxs`, and `Fragment` from here instead of calling `React.createElement`
// directly. Mirrors the working shim semantics found in the reference
// payload's `_preview/*.js` bundles (see CONTRACT.md), rebuilt as a real ES
// module against `window.React` (set by `_vendor/react.js` before this
// bundle runs).
const React = window.React;

function ownProps(props, key) {
  const out = {};
  for (const k in props) {
    if (k !== "children") out[k] = props[k];
  }
  if (key !== undefined) out.key = key;
  return out;
}

export function jsx(type, props, key) {
  const children = props && props.children;
  return children === undefined
    ? React.createElement(type, ownProps(props, key))
    : React.createElement(type, ownProps(props, key), children);
}

export function jsxs(type, props, key) {
  return React.createElement.apply(React, [type, ownProps(props, key)].concat(props.children));
}

export const Fragment = React.Fragment;
