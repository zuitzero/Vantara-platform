import type { IncomingMessage, ServerResponse } from 'node:http';
export type ShowroomConfig = { host: string; origin: string; key: string };
export const MARKER: string;
export const HEADER: string;
export function configuration(env: NodeJS.ProcessEnv): ShowroomConfig | null;
export function admits(config: ShowroomConfig, req: IncomingMessage, service: 'api' | 'web' | 'socket', raw?: string): boolean;
export function deny(response: ServerResponse): void;
