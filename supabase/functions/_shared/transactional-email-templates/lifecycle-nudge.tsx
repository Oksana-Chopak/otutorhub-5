/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

/**
 * Лист ланцюжка (13.10): один шаблон на всі кроки — привітання, «додай учня»,
 * «постав урок», «познач оплату», тріал (7 днів / 2 дні / закінчився), сплячі.
 * Слова приходять готовими з `_shared/lifecycleTexts.ts` (мовою людини), тут —
 * лише вигляд. Внизу — посилання «відписатися» (той самий механізм, що в
 * розсилках: marketing_unsubscribe_tokens), бо це не чек і не нагадування про
 * оплату, а наш лист людині.
 */
interface Props {
  title?: string
  lines?: string[]
  ctaText?: string
  ctaUrl?: string
  unsubscribeUrl?: string
  lang?: 'uk' | 'en' | 'sv'
  appName?: string
}

const main = {
  backgroundColor: '#f6f6f7',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
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
const heading = { color: '#111827', fontSize: '20px', fontWeight: 700, margin: '0 0 16px 0', lineHeight: '1.3' }
const paragraph = { color: '#374151', fontSize: '15px', lineHeight: '1.6', margin: '0 0 14px 0' }
const footer = { color: '#6b7280', fontSize: '12px', lineHeight: '1.5', margin: '8px 0 0 0' }

const UNSUB: Record<string, string> = {
  uk: 'Не хочеш таких листів? Відписатися',
  en: 'Don’t want these emails? Unsubscribe',
  sv: 'Vill du inte ha dessa mejl? Avsluta prenumeration',
}
const TAIL: Record<string, string> = {
  uk: 'oTutorHub — уроки, оплати й нагадування для репетиторів.',
  en: 'oTutorHub — lessons, payments and reminders for tutors.',
  sv: 'oTutorHub — lektioner, betalningar och påminnelser för lärare.',
}

function LifecycleNudgeEmail({ title, lines = [], ctaText, ctaUrl, unsubscribeUrl, lang = 'uk', appName = 'oTutorHub' }: Props) {
  return (
    <Html>
      <Head />
      <Preview>{title ?? appName}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={heading}>{title}</Heading>
          {lines.map((l, i) => (
            <Text key={i} style={paragraph}>{l}</Text>
          ))}
          {ctaUrl && ctaText ? (
            <Section style={{ margin: '18px 0 6px' }}>
              <Button
                href={ctaUrl}
                style={{ backgroundColor: '#2BBFAA', color: '#0f0f1a', fontWeight: 700, fontSize: '15px', borderRadius: '12px', padding: '13px 20px', textDecoration: 'none', display: 'inline-block' }}
              >
                {ctaText} →
              </Button>
            </Section>
          ) : null}
          <Text style={footer}>{TAIL[lang] ?? TAIL.uk}</Text>
          {unsubscribeUrl ? (
            <Text style={footer}>
              <Link href={unsubscribeUrl} style={{ color: '#6b7280' }}>{UNSUB[lang] ?? UNSUB.uk}</Link>
            </Text>
          ) : null}
        </Container>
      </Body>
    </Html>
  )
}

export const template: TemplateEntry = {
  component: LifecycleNudgeEmail,
  subject: (data) => String(data.title ?? 'oTutorHub'),
  displayName: 'Лист ланцюжка (онбординг / тріал / сплячі)',
  previewData: {
    title: 'Марто, додай першого учня — це 20 секунд',
    lines: [
      'Поки в застосунку немає учнів, йому нема про що нагадувати 🙂',
      'Маєш Google Таблицю чи список у нотатках? Встав — ми розберемо все самі: імена, предмети, ціни, борги.',
    ],
    ctaText: 'Додати учня',
    ctaUrl: 'https://otutorhub.com/my-students?new=1',
    unsubscribeUrl: 'https://otutorhub.com/marketing-unsubscribe?token=demo',
    lang: 'uk',
  },
}
