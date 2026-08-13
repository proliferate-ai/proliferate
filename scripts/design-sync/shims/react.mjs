// Design-sync bundle shim for the "react" specifier.
//
// `_ds_bundle.js` must not carry its own copy of React (two copies break
// hooks) — see CONTRACT.md "React MUST be external to `_ds_bundle.js`". This
// module is aliased in place of the real `react` package by build-bundle.mjs,
// and simply forwards to the single copy the host page loads via
// `_vendor/react.js`, which assigns `window.React` before `_ds_bundle.js`
// runs (load order is styles -> _vendor/react.js -> _vendor/react-dom.js ->
// _ds_bundle.js).
const React = window.React;

export default React;

export const Children = React.Children;
export const Component = React.Component;
export const Fragment = React.Fragment;
export const Profiler = React.Profiler;
export const PureComponent = React.PureComponent;
export const StrictMode = React.StrictMode;
export const Suspense = React.Suspense;
export const cloneElement = React.cloneElement;
export const createContext = React.createContext;
export const createElement = React.createElement;
export const createFactory = React.createFactory;
export const createRef = React.createRef;
export const forwardRef = React.forwardRef;
export const isValidElement = React.isValidElement;
export const lazy = React.lazy;
export const memo = React.memo;
export const startTransition = React.startTransition;
export const unstable_act = React.unstable_act;
export const useActionState = React.useActionState;
export const useCallback = React.useCallback;
export const useContext = React.useContext;
export const useDebugValue = React.useDebugValue;
export const useDeferredValue = React.useDeferredValue;
export const useEffect = React.useEffect;
export const useId = React.useId;
export const useImperativeHandle = React.useImperativeHandle;
export const useInsertionEffect = React.useInsertionEffect;
export const useLayoutEffect = React.useLayoutEffect;
export const useMemo = React.useMemo;
export const useOptimistic = React.useOptimistic;
export const useReducer = React.useReducer;
export const useRef = React.useRef;
export const useState = React.useState;
export const useSyncExternalStore = React.useSyncExternalStore;
export const useTransition = React.useTransition;
export const version = React.version;
