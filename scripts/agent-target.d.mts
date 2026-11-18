// Types for scripts/agent-target.mjs.
export type Target = 'core' | 'cloud' | 'local-power'
export type ToolReport = { name: string; version: string | null; status: 'up' | 'down' | 'invalid'; detail: string }
type Env = Record<string, string | undefined>

export declare const STATE_FILE: string
export declare const TIMEOUT_MS: number
export declare function detectTarget(options?: { env?: Env; root?: string }): Target
export declare function readState(root?: string): { tools: unknown[]; problem: string | null }
export declare function findOnPath(command: string, env?: Env): string | null
export declare function probeTool(tool: unknown, options?: { env?: Env; timeoutMs?: number }): Promise<ToolReport>
export declare function report(options?: { env?: Env; root?: string; timeoutMs?: number }): Promise<{ target: Target; tools: ToolReport[]; problem: string | null }>
