import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CreditCard } from "lucide-react";
import { toast } from "sonner";

interface LiqPayPayButtonProps {
  plan: "monthly" | "yearly";
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
      checkoutWindow.document.write("<p>Переходимо до LiqPay…</p>");
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
        toast.error("Не вдалося створити платіж. Спробуйте пізніше.");
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

      toast.success("Відкриваємо вікно оплати LiqPay…");
    } catch (e) {
      console.error(e);
      checkoutWindow?.close();
      toast.error("Сталася помилка. Спробуйте ще раз.");
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
      {label ?? "Сплатити карткою"}
    </Button>
  );
}
