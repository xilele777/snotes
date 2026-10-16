import { z } from 'zod'

export const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/)
const markdown = z.string().max(500_000).refine(value => new TextEncoder().encode(value).length <= 1_000_000, 'Markdown must not exceed 1 MB')
const write = { notebook_id: id, operation_id: id.describe('Unique request ID. Reuse exactly this ID and arguments when retrying a write.') }
const parent = id.nullable().optional().describe('Parent folder ID; omit for the notebook root.')

export const agentSchemas = {
  list_notebooks: z.object({}).strict(),
  get_notebook: z.object({ notebook_id: id }).strict(),
  search_notes: z.object({ notebook_id: id, query: z.string().trim().min(1).max(200), offset: z.number().int().min(0).max(1000).optional() }).strict(),
  get_note: z.object({ notebook_id: id, note_id: id }).strict(),
  create_folder: z.object({ ...write, title: z.string().trim().min(1).max(100), parent_id: parent }).strict(),
  create_note: z.object({ ...write, content: markdown, parent_id: parent }).strict(),
  update_note: z.object({ ...write, note_id: id, content: markdown, base_version: z.number().int().min(1) }).strict(),
  append_note: z.object({ ...write, note_id: id, content: markdown.min(1), base_version: z.number().int().min(1) }).strict(),
}
export type AgentTool = keyof typeof agentSchemas
