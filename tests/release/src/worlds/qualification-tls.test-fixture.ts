import { readFileSync } from "node:fs";

import type { QualificationTlsInput } from "./qualification-tls.js";

const material = JSON.parse(
  readFileSync(new URL("../../fixtures/qualification-tls-test-material.json", import.meta.url), "utf8"),
) as QualificationTlsInput;

export const TEST_QUALIFICATION_TLS: QualificationTlsInput = {
  certificateBase64: material.certificateBase64,
  privateKeyBase64: material.privateKeyBase64,
};
