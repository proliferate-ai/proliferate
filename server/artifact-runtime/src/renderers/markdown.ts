import DOMPurify from "dompurify";
import { marked } from "marked";

interface RenderMarkdownOptions {
  container: HTMLElement;
  content: string;
  onOpenLink: (url: string) => void;
}

function bindOpenLinks(root: HTMLElement, onOpenLink: (url: string) => void) {
  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const anchor = target.closest("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) {
      return;
    }

    event.preventDefault();
    onOpenLink(anchor.href);
  });
}

export async function renderMarkdown({
  container,
  content,
  onOpenLink,
}: RenderMarkdownOptions): Promise<void> {
  const html = await marked.parse(content);
  const wrapper = document.createElement("div");
  wrapper.innerHTML = DOMPurify.sanitize(html);
  bindOpenLinks(wrapper, onOpenLink);
  container.replaceChildren(wrapper);
}
