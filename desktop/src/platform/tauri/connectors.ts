import { invoke } from "@tauri-apps/api/core";

export async function getConnectorSecret(
  connectionId: string,
  fieldId: string,
): Promise<string | null> {
  return invoke<string | null>("get_connector_secret", {
    connectionId,
    fieldId,
  });
}

export async function setConnectorSecret(
  connectionId: string,
  fieldId: string,
  value: string,
): Promise<void> {
  return invoke("set_connector_secret", {
    connectionId,
    fieldId,
    value,
  });
}

export async function deleteConnectorSecret(
  connectionId: string,
  fieldId: string,
): Promise<void> {
  return invoke("delete_connector_secret", {
    connectionId,
    fieldId,
  });
}
