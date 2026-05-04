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
  lessonDate?: string
  amount?: number
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

const amountBox = {
  backgroundColor: '#fef3c7',
  borderRadius: '8px',
  padding: '14px 18px',
  margin: '16px 0',
  color: '#78350f',
  fontSize: '16px',
  fontWeight: 600,
}

const footer = {
  color: '#6b7280',
  fontSize: '12px',
  lineHeight: '1.5',
  margin: '8px 0 0 0',
}

function PaymentReminderEmail({
  studentName,
  tutorName,
  subject,
  lessonDate,
  amount,
  appName = 'oTutorHub',
}: Props) {
  const greeting = studentName ? `Привіт, ${studentName}!` : 'Привіт!'
  return (
    <Html>
      <Head />
      <Preview>{`Нагадування про оплату уроку (${tutorName ?? 'репетитор'})`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={heading}>💳 Нагадування про оплату</Heading>
          <Text style={paragraph}>{greeting}</Text>
          <Text style={paragraph}>
            {tutorName ? <><strong>{tutorName}</strong> нагадує</> : 'Нагадуємо'} про оплату
            {subject ? <> уроку <strong>{subject}</strong></> : ' уроку'}
            {lessonDate ? <>, який відбувся {lessonDate}</> : ''}.
          </Text>
          {amount && amount > 0 ? (
            <Section style={amountBox}>Сума до сплати: {amount} ₴</Section>
          ) : null}
          <Text style={paragraph}>
            Дякуємо! 🙏 Якщо вже оплатили — просто проігноруйте це повідомлення.
          </Text>
          <Text style={footer}>{appName} — облік уроків і оплат для репетиторів.</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template: TemplateEntry = {
  component: PaymentReminderEmail,
  subject: (data) =>
    `Нагадування про оплату — ${data.tutorName ?? 'oTutorHub'}`,
  displayName: 'Нагадування про оплату',
  previewData: {
    studentName: 'Олег',
    tutorName: 'Марія Іваненко',
    subject: 'Англійська мова',
    lessonDate: '15 квітня',
    amount: 450,
  },
}
