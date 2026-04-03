export type Stage = 'human-order' | 'planner' | 'researcher' | 'writer' | 'qc' | 'publisher'

export type ItemType = 'human_order' | 'plan_artifact' | 'research_pack' | 'draft' | 'qc_report' | 'publish_bundle' | (string & {})

export type Task = {
  id: string
  type?: ItemType
  client_slug: string
  content_type?: string
  title?: string
  description?: string
  stage: Stage
  week?: number
  parent_id?: string | null
  status?: string
  priority?: 'low' | 'normal' | 'high'
  owner?: string
  eta?: string
  research_date?: string | null // YYYY-MM-DD (optional)
  writer_date?: string | null // YYYY-MM-DD (optional)
  qc_date?: string | null // YYYY-MM-DD (optional)
  publish_date?: string | null // YYYY-MM-DD (optional)
  qc_spotcheck?: boolean
  deliverables?: Record<string, number>
  artifact_path?: string
  plan_id?: string
  source_input?: string
  source_type?: string
}

export type WeekState = {
  year: number
  week: number
  columns?: Stage[]
  tasks: Task[]
}

export type LiveState = {
  year: number
  week: number
  updatedAt?: string
  tasks: Array<
    Pick<Task, 'id'> &
      Partial<Pick<Task, 'stage' | 'owner' | 'eta' | 'research_date' | 'writer_date' | 'qc_date' | 'publish_date' | 'parent_id'>>
  >
}
