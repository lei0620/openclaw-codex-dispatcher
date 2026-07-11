export interface ConnectionSettings {
  token: string;
  apiBase: string;
}

export function createConnectionSettingsStore(options: {
  nativeStore?: { load(): Promise<ConnectionSettings>; save(settings: ConnectionSettings): Promise<unknown> };
  localStorage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  defaultApiBase(): string;
}): {
  load(): Promise<ConnectionSettings & { storage: "native" | "browser" }>;
  save(settings: ConnectionSettings): Promise<void>;
};
