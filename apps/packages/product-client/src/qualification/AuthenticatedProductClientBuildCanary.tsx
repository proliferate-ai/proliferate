import registry from "./assets/generated-registry.json";
import rawNote from "./assets/canary-note.txt?raw";
import rawIcon from "./assets/canary-icon.svg?raw";
import iconUrl from "./assets/canary-icon.svg";
import imageUrl from "./assets/canary-image.svg";
import audioUrl from "./assets/canary-audio.wav";
import fontUrl from "./assets/canary-font.woff2";

export function AuthenticatedProductClientBuildCanary() {
  return (
    <section
      aria-label="Authenticated ProductClient build canary"
      data-canary-registry-name={registry.name}
      data-canary-registry-count={registry.entries.length}
      data-canary-raw-note={rawNote.trim()}
      data-canary-raw-svg={rawIcon.includes("ProductClient canary") ? "loaded" : "missing"}
    >
      <p>Lazy authenticated root loaded.</p>
      <img alt="" src={iconUrl} width={24} height={24} />
      <img alt="" src={imageUrl} width={80} height={45} />
      <audio data-canary-audio={audioUrl} />
      <span data-canary-font={fontUrl}>font asset</span>
    </section>
  );
}
