// Registry of all transactional email templates.
// Each template entry exports its React component and a subject (string or function).
import { template as studentInvite } from './student-invite.tsx'

export type TemplateEntry = {
  component: (props: any) => any
  subject: string | ((data: Record<string, any>) => string)
  displayName?: string
  previewData?: Record<string, any>
  /** Optional fixed recipient (overrides caller-provided email) */
  to?: string
}

export const TEMPLATES: Record<string, TemplateEntry> = {
  'student-invite': studentInvite,
}
