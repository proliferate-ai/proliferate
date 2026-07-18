type SessionCreationMaterializationModule = Pick<
  typeof import("#product/hooks/sessions/workflows/session-creation-materialization"),
  "materializeSessionCreation"
>;

const loadMaterializationModule = () => import(
  "#product/hooks/sessions/workflows/session-creation-materialization"
);

/** Load executable create code before allowing durable setup to begin. */
export async function prepareSessionCreationMaterializer(
  input: {
    shouldSetupPendingCreation: boolean;
    setupPendingCreation: () => Promise<void>;
  },
  loadModule: () => Promise<SessionCreationMaterializationModule> =
    loadMaterializationModule,
): Promise<SessionCreationMaterializationModule["materializeSessionCreation"]> {
  const { materializeSessionCreation } = await loadModule();
  if (input.shouldSetupPendingCreation) {
    await input.setupPendingCreation();
  }
  return materializeSessionCreation;
}
