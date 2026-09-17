import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { App, type AppProps } from "./App";
import { RouteLifecycle } from "./route-lifecycle";
import { getApplicationRoute, isAppDestination, shouldHandleLink } from "./client-navigation";
import { beginPageBusy, isPageBusy } from "../../../work/assets/page-feedback.js";
import { Header } from "./components/Header";
import { SiteFooter } from "./components/SiteFooter";
import { SkipLink } from "./components/SkipLink";

type Frame = { id: number; props: AppProps; host: HTMLDivElement | null; ready: () => void };

/** Prepare the next route in a detached portal, then swap once. No duplicate IDs
 * enter the document, and the current page stays visible throughout loading. */
export function ApplicationRouter(props: AppProps = {}) {
  const slot = useRef<HTMLDivElement>(null);
  const nextId = useRef(0);
  const pendingId = useRef(0);
  const currentId = useRef(0);
  const endLoading = useRef<(() => void) | null>(null);
  const initialReady = useRef(Boolean(props.landingRoute));
  const mounted = useRef(true);
  const [preparing, setPreparing] = useState(false);
  const [frames, setFrames] = useState<Frame[]>(() => [{ id: 0, props, host: null, ready: () => finish(0) }]);
  const framesRef = useRef(frames);
  framesRef.current = frames;

  function finish(id: number) {
    // Wait for React state updates and imperative rendering before exposing the route.
    requestAnimationFrame(() => {
      if (!mounted.current || pendingId.current !== id) return;
      const frame = framesRef.current.find(item => item.id === id);
      if (!frame) return;
      initialReady.current = true;
      currentId.current = id;
      flushSync(() => { setFrames([frame]); setPreparing(false); });
      if (frame.host && slot.current) slot.current.replaceChildren(frame.host);
      document.getElementById("app")?.removeAttribute("data-app-booting");
      endLoading.current?.();
      endLoading.current = null;
      if (id || window.location.hash) {
        let fragment = window.location.hash.slice(1);
        try { fragment = decodeURIComponent(fragment); } catch { /* Malformed fragments have no matching target. */ }
        const target = fragment && document.getElementById(fragment);
        if (target) target.scrollIntoView({ block: "start", behavior: "instant" });
        else window.scrollTo({ top: 0, behavior: "instant" });
        requestAnimationFrame(() => document.getElementById("main")?.focus({ preventScroll: true }));
      }
    });
  }

  const navigate = useCallback((destination: string, replace = false, fromHistory = false) => {
    const url = new URL(destination, window.location.href);
    if (!isAppDestination(url.href, window.location.origin)) return false;
    const id = ++nextId.current;
    pendingId.current = id;
    const previousEnd = endLoading.current;
    endLoading.current = beginPageBusy("טוענים את העמוד…");
    previousEnd?.();
    if (!fromHistory) window.history[replace ? "replaceState" : "pushState"](null, "", url.href);
    const host = document.createElement("div");
    host.className = "app-route-frame";
    const frame: Frame = {
      id, host, ready: () => finish(id),
      props: getApplicationRoute(url.href),
    };
    setPreparing(true);
    setFrames(current => [...current.filter(item => item.id === currentId.current), frame]);
    return true;
  }, []);

  useLayoutEffect(() => {
    mounted.current = true;
    if (!initialReady.current) endLoading.current = beginPageBusy("טוענים את העמוד…");
    return () => { mounted.current = false; endLoading.current?.(); };
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    document.addEventListener("click", event => {
      const link = (event.target as Element)?.closest<HTMLAnchorElement>("a[href]");
      if (!link || !shouldHandleLink(event, link, window.location.href)) return;
      // The mounted campaign already supports project/prize navigation with one
      // scoped revalidation. Keep that path instead of rebuilding its controller.
      if (["project", "prizes"].includes(link.dataset.pageTarget || "") && link.closest("[data-campaign-ready]")) return;
      event.preventDefault();
      event.stopPropagation();
      if (!isPageBusy() && link.getAttribute("aria-current") !== "page") navigate(link.href);
    }, { capture: true, signal: abort.signal });
    window.addEventListener("goodraise:navigate", ((event: CustomEvent<{ destination: string; replace: boolean }>) => {
      if (navigate(event.detail.destination, event.detail.replace)) event.preventDefault();
    }) as EventListener, { signal: abort.signal });
    window.addEventListener("popstate", event => {
      // Same-page anchor history does not need a new route or a session request.
      const frame = framesRef.current.find(item => item.id === currentId.current);
      if (pendingId.current === currentId.current && frame?.props.landingRoute && getApplicationRoute(window.location.href).landingRoute) return;
      // Own Back/Forward before a campaign controller can force a document reload.
      event.stopImmediatePropagation();
      if (!navigate(window.location.href, false, true)) window.location.reload();
    }, { capture: true, signal: abort.signal });
    return () => abort.abort();
  }, [navigate]);

  const renderFrame = (frame: Frame) => <RouteLifecycle.Provider value={{ paused: preparing && frame.id !== pendingId.current, ready: frame.ready }}>
    <App {...frame.props} />
  </RouteLifecycle.Provider>;
  return <div className="site-shell">
    <SkipLink />
    <Header loadSession />
    <div className="site-content">
      {frames.filter(frame => !frame.host).map(frame => <div className="app-route-frame" key={frame.id}>{renderFrame(frame)}</div>)}
      <div ref={slot} />
      {frames.filter(frame => frame.host).map(frame => createPortal(renderFrame(frame), frame.host!, frame.id))}
    </div>
    <SiteFooter />
  </div>;
}
