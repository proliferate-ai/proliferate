import "./styles.css";
import { createRuntimeBridge } from "./bridge";
import { dispatchArtifactRender } from "./dispatcher";

const app = document.getElementById("app");
if (!(app instanceof HTMLElement)) {
  throw new Error("Artifact runtime root not found.");
}

app.className = "artifact-host";

const bridge = createRuntimeBridge({
  onSetContent: async (payload) => {
    document.title = payload.title;
    await dispatchArtifactRender({
      container: app,
      payload,
      clearChildFrames: bridge.clearChildFrames,
      registerChildFrame: bridge.registerChildFrame,
      onOpenLink: bridge.openLink,
      onError: bridge.reportError,
    });
  },
});

bridge.start();
