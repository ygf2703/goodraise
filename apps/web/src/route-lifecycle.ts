import { createContext, useContext } from "react";

export const RouteLifecycle = createContext({ paused: false, ready: () => {} });
export const useRouteLifecycle = () => useContext(RouteLifecycle);
