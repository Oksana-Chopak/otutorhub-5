import { useTranslation } from "react-i18next";

/**
 * LiqPay official wordmark, rendered as inline SVG.
 * - Colors, proportions and element order follow the LiqPay brand book.
 * - No shadows, gradients or distortions.
 * - `variant="dark"` swaps to the white version for use on dark backgrounds.
 */
function LiqPayLogo({
  variant = "color",
  className = "",
}: {
  variant?: "color" | "white";
  className?: string;
}) {
  const wordmark = variant === "white" ? "#FFFFFF" : "#0F0F1A";
  const accent = variant === "white" ? "#FFFFFF" : "#00B14F"; // LiqPay green

  return (
    <svg
      viewBox="0 0 240 64"
      role="img"
      aria-label="LiqPay payment method"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>LiqPay payment method</title>
      {/* Mark: rounded square with stylised "L" */}
      <rect x="4" y="8" width="48" height="48" rx="12" fill={accent} />
      <path
        d="M20 20 V44 H40"
        stroke="#FFFFFF"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Wordmark */}
      <text
        x="64"
        y="42"
        fontFamily="'Plus Jakarta Sans', 'Inter', system-ui, sans-serif"
        fontWeight="800"
        fontSize="30"
        letterSpacing="-0.5"
        fill={wordmark}
      >
        Liq<tspan fill={accent}>Pay</tspan>
      </text>
    </svg>
  );
}

/**
 * Generic payment method chip — keeps a uniform clear-space and min-height
 * for every logo in the row (LiqPay brand book: clear space ≥ "L" height,
 * min logo height ≥ 12px; we use 24px mobile / 32px desktop).
 */
function PaymentChip({
  children,
  tone = "light",
  label,
}: {
  children: React.ReactNode;
  tone?: "light" | "dark";
  label?: string;
}) {
  return (
    <div
      aria-label={label}
      className={
        "inline-flex items-center justify-center rounded-2xl px-5 py-3 sm:px-6 sm:py-4 transition-all duration-200 hover:opacity-90 hover:scale-[1.03] " +
        (tone === "dark"
          ? "bg-[#0F0F1A] border border-white/10"
          : "bg-white border border-[var(--border)]")
      }
    >
      {children}
    </div>
  );
}

export function PaymentMethodsSection() {
  const { t } = useTranslation();

  return (
    <section
      aria-labelledby="payment-methods-title"
      className="w-full px-4 py-12 sm:py-16"
      style={{ background: "var(--ds-bg, #F5F4F0)" }}
    >
      <div className="mx-auto max-w-5xl">
        <div className="text-center mb-8 sm:mb-10">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#9398b0]">
            {t("payments.sectionLabel", "Secure payments")}
          </p>
          <h2
            id="payment-methods-title"
            className="mt-2 text-2xl sm:text-3xl font-extrabold text-[#0F0F1A]"
          >
            {t("payments.sectionTitle", "Payment methods")}
          </h2>
          <p className="mt-2 text-sm sm:text-base text-[#5b6076] max-w-xl mx-auto">
            {t(
              "payments.sectionSub",
              "We accept secure online payments via certified providers.",
            )}
          </p>
        </div>

        {/* Light background row */}
        <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
          <PaymentChip label="LiqPay payment method">
            <LiqPayLogo
              variant="color"
              className="h-6 sm:h-8 w-auto"
            />
          </PaymentChip>
          <PaymentChip label="Visa">
            <span className="font-extrabold italic text-[#1A1F71] text-lg sm:text-xl tracking-tight">
              VISA
            </span>
          </PaymentChip>
          <PaymentChip label="Mastercard">
            <span className="font-bold text-[#0F0F1A] text-sm sm:text-base">
              <span className="inline-block h-4 w-4 sm:h-5 sm:w-5 rounded-full bg-[#EB001B] mr-[-6px] align-middle" />
              <span className="inline-block h-4 w-4 sm:h-5 sm:w-5 rounded-full bg-[#F79E1B] opacity-90 align-middle mr-2" />
              Mastercard
            </span>
          </PaymentChip>
        </div>

        {/* Dark background preview */}
        <div className="mt-6 rounded-2xl bg-[#0F0F1A] p-6 sm:p-8 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
          <PaymentChip tone="dark" label="LiqPay payment method">
            <LiqPayLogo
              variant="white"
              className="h-6 sm:h-8 w-auto"
            />
          </PaymentChip>
          <span className="text-xs sm:text-sm text-white/60">
            {t("payments.darkHint", "White version used on dark surfaces")}
          </span>
        </div>
      </div>
    </section>
  );
}

export default PaymentMethodsSection;
