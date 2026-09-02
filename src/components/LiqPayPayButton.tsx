import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CreditCard } from "lucide-react";
import { toast } from "sonner";
import i18nInstance from "@/i18n";
import { PRICE_TOTAL, type PlanKey } from "@/lib/pricing";
import { formatPrice } from "@/lib/currency";
const t = i18nInstance.t.bind(i18nInstance);

interface LiqPayPayButtonProps {
  plan: "monthly" | "halfyear" | "yearly";
  recurring?: boolean;
  disabled?: boolean;
  className?: string;
  label?: string;
}

/**
 * Кнопка оплати через LiqPay Checkout.
 * 1. Викликає edge-функцію `liqpay-create-payment` → отримує підписані `data` + `signature`.
 * 2. Сабмітить форму POST на https://www.liqpay.ua/api/3/checkout у новій вкладці.
 * 3. LiqPay шле server-to-server callback → `liqpay-callback` активує підписку.
 *
 * Перевірка 02.09: edge-функції деплояться ОКРЕМО від фронтенду, тож після
 * зміни цін на сторінці тарифів стояла нова ціна, а LiqPay виставляв стару —
 * мовчки, бо клієнт суму не бачив. Тепер бачить: сума розшифровується з
 * підписаного `data` і звіряється з src/lib/pricing.ts. Не збіглось — на
 * LiqPay не йдемо взагалі.
 */
export function LiqPayPayButton({
  plan,
  recurring = true,
  disabled,
  className,
  label,
}: LiqPayPayButtonProps) {
  const [loading, setLoading] = useState(false);

  const handlePay = async () => {
    setLoading(true);
    const checkoutWindowName = `liqpay_checkout_${Date.now()}`;
    const checkoutWindow = window.open("", checkoutWindowName);
    if (checkoutWindow) {
      checkoutWindow.opener = null;
      checkoutWindow.document.write(t("liqPay.redirecting"));
    }

    try {
      const { data, error } = await supabase.functions.invoke("liqpay-create-payment", {
        body: {
          plan,
          recurring,
          result_url: `${window.location.origin}/subscription?paid=1`,
        },
      });

      if (error || !data?.data || !data?.signature) {
        console.error("LiqPay create error:", error, data);
        checkoutWindow?.close();
        toast.error(t("liqPay.createFailed"));
        return;
      }

      // Звірка суми: `data.data` — це base64 від JSON параметрів LiqPay,
      // тож суму видно без жодної довіри до сервера.
      const expected = PRICE_TOTAL[plan as PlanKey];
      let signedAmount: number | null = null;
      try {
        // TextDecoder, а не escape(): опис плану містить кирилицю.
        const bytes = Uint8Array.from(atob(data.data as string), (c) => c.charCodeAt(0));
        const parsed = JSON.parse(new TextDecoder().decode(bytes));
        signedAmount = Number(parsed?.amount);
      } catch {
        signedAmount = null;
      }
      if (signedAmount != null && Number.isFinite(signedAmount) && signedAmount !== expected) {
        console.error("LiqPay amount mismatch", { signedAmount, expected, plan });
        checkoutWindow?.close();
        toast.error(t("liqPay.amountMismatch"), {
          description: t("liqPay.amountMismatchDesc", {
            shown: formatPrice(expected, "UAH"),
            actual: formatPrice(signedAmount, "UAH"),
          }),
        });
        return;
      }

      // Створюємо приховану форму та сабмітимо на LiqPay
      const form = document.createElement("form");
      form.method = "POST";
      form.action = "https://www.liqpay.ua/api/3/checkout";
      form.acceptCharset = "utf-8";
      form.target = checkoutWindow ? checkoutWindowName : "_self";

      const dataInput = document.createElement("input");
      dataInput.type = "hidden";
      dataInput.name = "data";
      dataInput.value = data.data;
      form.appendChild(dataInput);

      const sigInput = document.createElement("input");
      sigInput.type = "hidden";
      sigInput.name = "signature";
      sigInput.value = data.signature;
      form.appendChild(sigInput);

      document.body.appendChild(form);
      form.submit();
      document.body.removeChild(form);

      toast.success(t("liqPay.opening"));
    } catch (e) {
      console.error(e);
      checkoutWindow?.close();
      toast.error(t("liqPay.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      type="button"
      onClick={handlePay}
      disabled={disabled || loading}
      className={className}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <CreditCard className="h-4 w-4" />
      )}
      {label ?? t("liqPay.payBtn")}
    </Button>
  );
}
