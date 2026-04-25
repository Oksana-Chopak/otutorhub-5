/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  studentName?: string
  inviterName?: string
  subjects?: string[]
  inviteUrl?: string
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
  fontSize: '22px',
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

const buttonStyle = {
  backgroundColor: '#0f172a',
  color: '#ffffff',
  borderRadius: '8px',
  display: 'inline-block',
  fontSize: '15px',
  fontWeight: 600,
  padding: '12px 22px',
  textDecoration: 'none',
}

const subjectsBox = {
  backgroundColor: '#f3f4f6',
  borderRadius: '8px',
  padding: '12px 14px',
  margin: '0 0 18px 0',
  color: '#111827',
  fontSize: '14px',
}

const footer = {
  color: '#6b7280',
  fontSize: '12px',
  lineHeight: '1.5',
  margin: '8px 0 0 0',
}

function StudentInviteEmail({
  studentName,
  inviterName,
  subjects = [],
  inviteUrl = 'https://otutorhub.com/auth?signup=1',
  appName = 'oTutorHub',
}: Props) {
  const greeting = studentName ? `Привіт, ${studentName}!` : 'Привіт!'
  const inviter = inviterName || 'Ваш репетитор'
  const subjectsLine =
    subjects.length > 0 ? subjects.join(', ') : null

  return (
    <Html>
      <Head />
      <Preview>{`${inviter} додав(ла) вас у ${appName}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={heading}>🎓 Вас додано в {appName}</Heading>

          <Text style={paragraph}>{greeting}</Text>

          <Text style={paragraph}>
            <strong>{inviter}</strong> додав(ла) вас як свого учня в {appName} —
            простір, де ви бачитимете розклад уроків, домашні завдання,
            конспекти та оплати в одному місці.
          </Text>

          {subjectsLine && (
            <Section style={subjectsBox}>
              <strong>Предмети:</strong> {subjectsLine}
            </Section>
          )}

          <Text style={paragraph}>
            Щоб почати — створіть акаунт. Використайте <strong>саме цей email</strong>,
            щоб ваш профіль автоматично зв'язався з тим, що завів репетитор:
          </Text>

          <Section style={{ textAlign: 'center', margin: '24px 0' }}>
            <Button href={inviteUrl} style={buttonStyle}>
              Створити акаунт
            </Button>
          </Section>

          <Text style={{ ...paragraph, fontSize: '13px', color: '#6b7280' }}>
            Якщо кнопка не працює, скопіюйте посилання в браузер:
            <br />
            <a href={inviteUrl} style={{ color: '#2563eb', wordBreak: 'break-all' }}>
              {inviteUrl}
            </a>
          </Text>

          <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0 16px 0' }} />

          <Text style={footer}>
            Якщо ви не очікували цього листа — просто проігноруйте його. Ми не
            створимо акаунт без вашої реєстрації.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: StudentInviteEmail,
  subject: (data: Record<string, any>) =>
    data?.inviterName
      ? `${data.inviterName} запрошує вас в oTutorHub`
      : 'Вас запросили в oTutorHub',
  displayName: 'Запрошення учня',
  previewData: {
    studentName: 'Іван',
    inviterName: 'Оксана',
    subjects: ['Математика', 'Фізика'],
    inviteUrl: 'https://otutorhub.com/auth?signup=1&email=ivan@example.com&role=student',
    appName: 'oTutorHub',
  },
} satisfies TemplateEntry
