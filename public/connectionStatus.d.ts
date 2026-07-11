export interface ConnectionStatusInput {
  nasReachable: boolean;
  onlineAgents: number;
  readyCodex: number;
}

export interface ConnectionStatus {
  level: "online" | "recovering" | "offline";
  label: string;
  detail: string;
}

export function deriveConnectionStatus(input: ConnectionStatusInput): ConnectionStatus;
