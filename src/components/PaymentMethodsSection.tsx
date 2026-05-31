/**
 * Minimal payment-methods strip for the site footer.
 * LiqPay requirements: https://www.liqpay.ua/information/requirements
 * On a dark footer we use the white/monochrome versions of each mark
 * (allowed by LiqPay brand book), no plates, no shadows, no distortions.
 */

function LiqPayMark() {
  return (
    <svg
      viewBox="0 0 72 18"
      height="16"
      role="img"
      aria-label="LiqPay"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
    >
      <text
        x="0"
        y="14"
        fontFamily="'Plus Jakarta Sans', 'Inter', system-ui, sans-serif"
        fontWeight="800"
        fontSize="16"
        letterSpacing="-0.3"
        fill="rgba(255,255,255,0.85)"
      >
        LiqPay
      </text>
    </svg>
  );
}

function VisaMark() {
  return (
    <span
      aria-label="Visa"
      className="font-extrabold italic tracking-tight"
      style={{
        color: "rgba(255,255,255,0.85)",
        fontSize: 14,
        lineHeight: 1,
      }}
    >
      VISA
    </span>
  );
}

function MastercardMark() {
  return (
    <span
      aria-label="Mastercard"
      className="relative inline-flex items-center"
      style={{ height: 14 }}
    >
      <span
        className="inline-block rounded-full"
        style={{
          width: 14,
          height: 14,
          background: "rgba(255,255,255,0.85)",
          opacity: 0.9,
        }}
      />
      <span
        className="inline-block rounded-full"
        style={{
          width: 14,
          height: 14,
          background: "rgba(255,255,255,0.55)",
          marginLeft: -5,
        }}
      />
    </span>
  );
}

export function PaymentMethodsSection() {
  return (
    <div
      className="flex items-center gap-4"
      aria-label="Accepted payment methods"
    >
      <LiqPayMark />
      <span style={{ width: 1, height: 12, background: "rgba(255,255,255,0.15)" }} />
      <VisaMark />
      <MastercardMark />
    </div>
  );
}

export default PaymentMethodsSection;
