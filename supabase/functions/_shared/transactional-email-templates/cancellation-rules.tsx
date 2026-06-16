/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  studentName?: string
  tutorName?: string
  subject?: string
  rulesText?: string
  appName?: string
}

const main = {
  backgroundColor: '#f6f6f7',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  margin: 0,
  padding: 0,
}

const container = {
  backgroundColor: '#ffffff',
  margin: '32px auto',
  padding: '32px 28px',
  maxWidth: '560px',
  borderRadius: '12px',
  border: '1px solid #e5e7eb',
}

const heading = {
  color: '#111827',
  fontSize: '20px',
  fontWeight: 600,
  margin: '0 0 16px 0',
  lineHeight: '1.3',
}

const paragraph = {
  color: '#374151',
  fontSize: '15px',
  lineHeight: '1.6',
  margin: '0 0 14px 0',
}

const rulesBox = {
  backgroundColor: '#f3f4f6',
  borderRadius: '8px',
  padding: '14px 18px',
  margin: '16px 0',
  color: '#111827',
  fontSize: '15px',
  lineHeight: '1.6',
  whiteSpace: 'pre-line' as const,
}

const footer = {
  color: '#6b7280',
  fontSize: '12px',
  lineHeight: '1.5',
  margin: '8px 0 0 0',
}

function CancellationRulesEmail({
  studentName,
  tutorName,
  subject,
  rulesText,
  appName = 'oTutorHub',
}: Props) {
  const greeting = studentName ? `Привіт, ${studentName}!` : 'Привіт!'
  return (
    <Html>
      <Head />
      <Preview>{`Правила скасування та перенесення (${tutorName ?? 'репетитор'})`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={heading}>📋 Правила скасування та перенесення</Heading>
          <Text style={paragraph}>{greeting}</Text>
          <Text style={paragraph}>
            {tutorName ? <><strong>{tutorName}</strong> запланував(ла)</> : 'Заплановано'} новий урок
            {subject ? <> з предмету <strong>{subject}</strong></> : ''}. Нагадуємо умови
            скасування та перенесення:
          </Text>
          {rulesText ? <Section style={rulesBox}>{rulesText}</Section> : null}
          <Text style={paragraph}>
            Будь ласка, попереджайте заздалегідь — так ми зможемо знайти зручний час. 🙏
          </Text>
          <Text style={footer}>{appName} — облік уроків і оплат для репетиторів.</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template: TemplateEntry = {
  component: CancellationRulesEmail,
  subject: (data) =>
    `Правила скасування та перенесення — ${data.tutorName ?? 'oTutorHub'}`,
  displayName: 'Правила скасування',
  previewData: {
    studentName: 'Олег',
    tutorName: 'Марія Іваненко',
    subject: 'Англійська мова',
    rulesText:
      'Безкоштовне скасування — не пізніше ніж за 24 год до уроку. Пізніше — 50% вартості. Неявка — 100%. Безкоштовних перенесень на місяць: 2.',
    appName: 'oTutorHub',
  },
}
