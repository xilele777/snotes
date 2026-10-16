export const AGENT_PERMISSIONS = ['read', 'create', 'update'] as const
export type AgentPermission = typeof AGENT_PERMISSIONS[number]

export interface AgentTokenInfo {
  id: string
  name: string
  prefix: string
  notebook_ids: string[]
  permissions: AgentPermission[]
  created_at: number
  expires_at: number | null
  revoked_at: number | null
  last_used_at: number | null
}

export interface AgentActivity {
  token_id: string
  token_name: string
  operation_id: string
  action: string
  notebook_id: string
  note_id: string | null
  created_at: number
}
