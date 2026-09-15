import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CreditCard } from "lucide-react";
import { toast } from "sonner";
import i18nInstance from "@/i18n";
import { PRICE_TOTAL, LIGHT_PRICE_MONTHLY, type PlanKey, type PayablePlanKey } from "@/lib/pricing";
import { formatPrice } from "@/lib/currency";
const t = i18nInstance.t.bind(i18nInstance);

interface LiqPayPayButtonProps {
  /** 'light' — план-рятівник із потоку скасування (05.09), у публічному прайсі його немає. */
  plan: PayablePlanKey;
  recurring?: boolean;
  disabled?: boolean;
  className?: string;
  label?: string;
  /**
   * Виконується ПЕРЕД створенням платежу; поверни false — оплата не стартує.
   * Потрібно save-оферу Light: спершу зупинити старе автопоновлення
   * (liqpay-cancel), і лише потім вести на чекаут нового плану.
   */
  onBeforePay?: () => Promise<boolean>;
}

/**
 * Кнопка оплати через LiqPay Checkout.
 * 1. Викликає edge-функцію `liqpay-create-payment` → отримує підписані `data` + `signature`.
 * 2. Сабмітить форму POST на https://www.liqpay.ua/api/3/checkout У ЦІЙ САМІЙ вкладці
 *    (15.09: друге вікно вмирало у webview месенджера — див. handlePay).
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
  onBeforePay,
}: LiqPayPayButtonProps) {
  const [loading, setLoading] = useState(false);

  const handlePay = async () => {
    setLoading(true);
    /* 15.09, скарга живого користувача: «не переводит на LiqPay, страница не
       грузится дальше». На скріншоті — порожня вкладка `about:blank` з написом
       «Redirecting to LiqPay…», яка висить назавжди. Людина відкрила застосунок
       із МЕСЕНДЖЕРА (вбудований webview Facebook).

       Тут був чекаут у ДРУГОМУ вікні: синхронно відкривалась порожня вкладка, потім
       форма з `target=<name>`. Два незалежні способи, якими це вмирає:
       1) обнулення `opener` у нового вікна відривало його від групи вікон
          відкривача — після цього браузер уже НЕ знаходить його за іменем, і
          `form.target` створює ЩЕ ОДНЕ вікно. Але на цей момент жест кліку
          давно з'їдено `await`, тож блокувальник спливайок його не пускає;
          перша вкладка лишається з «Redirecting…» назавжди.
       2) У вбудованих браузерах (Messenger, Instagram, Telegram) іменовані
          вікна часто не працюють узагалі — там одна вкладка.

       Оплата — найдорожчий екран продукту: він мусить працювати скрізь, а не
       там, де popup поводиться добре. Тому чекаут відкривається В ЦІЙ САМІЙ
       вкладці, як це роблять усі платіжні провайдери; повернення назад —
       через result_url. Жодних popup, жодних імен вікон, жодних блокувальників. */
    if (onBeforePay) {
      // Підготовчий крок (напр., зупинка старого автопоновлення для Light);
      // false — платіж не стартує.
      let ok = false;
      try { ok = await onBeforePay(); } catch { ok = false; }
      if (!ok) { setLoading(false); return; }
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
        toast.error(t("liqPay.createFailed"));
        return;
      }

      // Звірка суми: `data.data` — це base64 від JSON параметрів LiqPay,
      // тож суму видно без жодної довіри до сервера.
      const expected = plan === "light" ? LIGHT_PRICE_MONTHLY : PRICE_TOTAL[plan as PlanKey];
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
      // Та сама вкладка — див. пояснення на початку handlePay.
      form.target = "_self";

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
      // Вкладку вже забирає LiqPay; форму лишаємо в DOM — видалення тут
      // інколи встигає скасувати submit у Safari.
    } catch (e) {
      console.error(e);
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
