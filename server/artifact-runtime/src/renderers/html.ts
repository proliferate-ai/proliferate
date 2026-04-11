interface RenderHtmlOptions {
  container: HTMLElement;
  content: string;
  registerChildFrame: (iframe: HTMLIFrameElement) => void;
}

function injectHtmlBridge(content: string, runtimeOrigin: string): string {
  const bridge = `
<script>
const targetOrigin = ${JSON.stringify(runtimeOrigin)};
window.addEventListener("error", function (event) {
  window.parent.postMessage({
    method: "ReportError",
    payload: {
      type: "RuntimeError",
      message: String(event.error?.message || event.message || "Artifact runtime failed"),
    },
  }, targetOrigin);
});
document.addEventListener("click", function (event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return;
  event.preventDefault();
  window.parent.postMessage({
    method: "OpenLink",
    payload: { url: anchor.href },
  }, targetOrigin);
});
</script>`;
  return content.includes("</body>")
    ? content.replace("</body>", `${bridge}</body>`)
    : `${content}${bridge}`;
}

export async function renderHtml({
  container,
  content,
  registerChildFrame,
}: RenderHtmlOptions): Promise<void> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.className = "artifact-frame";
  iframe.srcdoc = injectHtmlBridge(content, window.location.origin);
  container.replaceChildren(iframe);
  registerChildFrame(iframe);
}
