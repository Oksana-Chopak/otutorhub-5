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

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({
  siteName,
  confirmationUrl,
}: MagicLinkEmailProps) => (
  <Html lang="uk" dir="ltr">
    <Head />
    <Preview>Посилання для входу в {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Посилання для входу</Heading>
        <Text style={text}>
          Натисніть кнопку нижче, щоб увійти в {siteName}. Посилання діє
          обмежений час.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Увійти
        </Button>
        <Text style={footer}>
          Якщо ви не запитували це посилання — просто проігноруйте лист.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default MagicLinkEmail

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
