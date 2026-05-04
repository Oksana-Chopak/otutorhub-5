/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({
  siteName,
  confirmationUrl,
}: RecoveryEmailProps) => (
  <Html lang="uk" dir="ltr">
    <Head />
    <Preview>Скидання паролю для {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Скидання паролю</Heading>
        <Text style={text}>
          Ми отримали запит на скидання паролю для {siteName}. Натисніть кнопку
          нижче, щоб обрати новий пароль.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Скинути пароль
        </Button>
        <Text style={footer}>
          Якщо ви не запитували скидання — просто проігноруйте цей лист. Ваш
          пароль залишиться без змін.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default RecoveryEmail

const main = {
  backgroundColor: '#ffffff',
  fontFamily:
    'Inter, "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
}
const container = { padding: '24px 28px', maxWidth: '560px' }
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: 'hsl(224, 71%, 9%)',
  margin: '0 0 20px',
}
const text = {
  fontSize: '14px',
  color: 'hsl(220, 9%, 46%)',
  lineHeight: '1.5',
  margin: '0 0 20px',
}
const button = {
  backgroundColor: 'hsl(178, 90%, 38%)',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: '600' as const,
  borderRadius: '8px',
  padding: '12px 20px',
  textDecoration: 'none',
  display: 'inline-block',
}
const footer = { fontSize: '12px', color: 'hsl(220, 9%, 60%)', margin: '32px 0 0' }
