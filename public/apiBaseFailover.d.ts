export interface ApiRequestOptions {
  method?: string;
  body?: string;
}

export function buildApiBaseCandidates(preferred: string, fallbacks?: string[]): string[];
export function isFailoverSafeRequest(url: string, options?: ApiRequestOptions): boolean;
