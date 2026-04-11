import DOMPurify from "dompurify";

interface RenderSvgOptions {
  container: HTMLElement;
  content: string;
  onOpenLink: (url: string) => void;
}

export async function renderSvg({
  container,
  content,
  onOpenLink,
}: RenderSvgOptions): Promise<void> {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = DOMPurify.sanitize(content, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["script", "foreignObject"],
  });

  wrapper.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const anchor = target.closest("a[href]");
    if (!(anchor instanceof SVGAElement)) {
      return;
    }

    const href = anchor.href.baseVal;
    if (!href) {
      return;
    }

    event.preventDefault();
    onOpenLink(href);
  });
  container.replaceChildren(wrapper);
}
