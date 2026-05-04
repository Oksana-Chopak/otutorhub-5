/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="uk" dir="ltr">
    <Head />
    <Preview>Ваш код підтвердження</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Підтвердження особи</Heading>
        <Text style={text}>Введіть код нижче, щоб підтвердити свою особу:</Text>
        <Text style={codeStyle}>{token}</Text>
        <Text style={footer}>
          Код діє обмежений час. Якщо ви не запитували його — просто
          проігноруйте лист.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default ReauthenticationEmail

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
const codeStyle = {
  fontFamily: 'Courier, monospace',
  fontSize: '28px',
  letterSpacing: '4px',
  fontWeight: 'bold' as const,
  color: 'hsl(178, 90%, 38%)',
  margin: '0 0 30px',
}
const footer = { fontSize: '12px', color: 'hsl(220, 9%, 60%)', margin: '32px 0 0' }
