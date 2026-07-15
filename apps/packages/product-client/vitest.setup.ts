import { setMeasurementSink } from "#product/lib/infra/measurement/measurement-port";
// Test-lane only reach into the retained Desktop measurement engine (ruling R1).
// This file lives at the package root — outside `src/`, so the frontend boundary
// checker (which scans `src/`) does not treat it as a product→host import, and it
// never ships in `dist`. Production injects the identical `desktopMeasurementSink`
// at `DesktopHostProviders` module scope; the sink module's own docstring names
// this setup as its second intended consumer.
import { desktopMeasurementSink } from "../../desktop/src/lib/infra/measurement/measurement-port-sink";

// The moved product tree records measurement through the swappable sink port,
// whose package default is a type-safe no-op. Inject the concrete retained engine
// so measurement-asserting tests observe real behavior (byte-identical to the
// pre-move Desktop lane). Idempotent (last writer wins); runs once per test file.
setMeasurementSink(desktopMeasurementSink);
