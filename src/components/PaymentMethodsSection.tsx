/**
 * Minimal payment-methods strip for the site footer.
 * Follows LiqPay merchant requirements:
 *  https://www.liqpay.ua/information/requirements
 *
 *  - Shows LiqPay + Visa + Mastercard marks together
 *  - Original colors of LiqPay logo preserved (green wordmark on white plate)
 *  - Clear space ≥ height of "L"; min logo height 24px
 *  - No shadows, gradients, distortions, rotations
 *  - Works on dark footer background
 */

function LiqPayMark({ className = "" }: { className?: string }) {
  // Official-style wordmark: black "Liq" + green "Pay" on white plate
  return (
    <span
      aria-label="LiqPay"
      className={
        "inline-flex items-center rounded-md bg-white px-2.5 py-1.5 " +
        className
      }
      style={{ minHeight: 24 }}
    >
      <svg
        viewBox="0 0 96 24"
        height="20"
        role="img"
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
      >
        <text
          x="0"
          y="18"
          fontFamily="'Plus Jakarta Sans', 'Inter', system-ui, sans-serif"
          fontWeight="800"
          fontSize="20"
          letterSpacing="-0.5"
          fill="#0F0F1A"
        >
          Liq<tspan fill="#00B14F">Pay</tspan>
        </text>
      </svg>
    </span>
  );
}

function VisaMark() {
  return (
    <span
      aria-label="Visa"
      className="inline-flex items-center rounded-md bg-white px-2.5 py-1.5"
      style={{ minHeight: 24 }}
    >
      <span
        className="font-extrabold italic tracking-tight"
        style={{ color: "#1A1F71", fontSize: 14, lineHeight: 1 }}
      >
        VISA
      </span>
    </span>
  );
}

function MastercardMark() {
  return (
    <span
      aria-label="Mastercard"
      className="inline-flex items-center rounded-md bg-white px-2.5 py-1.5"
      style={{ minHeight: 24 }}
    >
      <span className="relative inline-flex items-center" style={{ height: 14 }}>
        <span
          className="inline-block rounded-full"
          style={{ width: 14, height: 14, background: "#EB001B" }}
        />
        <span
          className="inline-block rounded-full"
          style={{
            width: 14,
            height: 14,
            background: "#F79E1B",
            marginLeft: -5,
            mixBlendMode: "multiply",
          }}
        />
      </span>
    </span>
  );
}

export function PaymentMethodsSection() {
  return (
    <div
      className="flex items-center gap-2"
      aria-label="Accepted payment methods"
    >
      <LiqPayMark />
      <VisaMark />
      <MastercardMark />
    </div>
  );
}

export default PaymentMethodsSection;
