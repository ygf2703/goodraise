import { useEffect, useRef } from "react";
import landing from "../generated/landing.json";
import { mountLandingCarousel } from "../../../../work/assets/landing-carousel.js";
import { useRouteLifecycle } from "../route-lifecycle";

export function LandingPage() {
  const root = useRef<HTMLDivElement>(null);
  const route = useRouteLifecycle();
  useEffect(() => {
    if (route.paused || !root.current) return;
    const abort = new AbortController();
    mountLandingCarousel(root.current, abort.signal);
    route.ready();
    return () => abort.abort();
  }, [route.paused, route.ready]);
  // The markup is generated only from work/goodraise-landing.html, never user data.
  return <div ref={root} dangerouslySetInnerHTML={{ __html: landing.html }} />;
}
