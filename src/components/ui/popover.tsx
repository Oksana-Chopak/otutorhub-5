import * as React from "react";
import { subscribeKeyboard, getKeyboardCover } from "@/lib/keyboardInset";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, onWheel, onTouchMove, collisionPadding, style, ...props }, ref) => {
  /* 13.11: спливне вікно з полем пошуку ставало ПІД екранну клавіатуру — воно рахує вільним увесь
     екран. Кажемо йому, скільки низу зайнято клавіатурою: тоді воно саме розвертається вгору. */
  const kbCover = React.useSyncExternalStore(subscribeKeyboard, getKeyboardCover, () => 0);
  const padding = collisionPadding ?? (kbCover > 0 ? { top: 8, bottom: kbCover + 8 } : undefined);
  return (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      collisionPadding={padding}
      /* коли місця над клавіатурою менше, ніж треба вікну, воно стискається до вільного місця й
         гортається всередині, а не ховає низ списку під клавіатуру */
      style={kbCover > 0 ? { ...style, maxHeight: "var(--radix-popover-content-available-height)", overflowY: "auto" } : style}
      /* 13.11, скарга власниці: «скрол годин мертвий». Спливне вікно малюється поза
         діалогом, а діалог блокує прокрутку всього, що поза ним, — тож колонки годин,
         календар і будь-який список у спливному вікні всередині форми не гортались ні
         колесом, ні пальцем. Подія не доходить до замка діалогу — прокрутка жива. */
      onWheel={(e) => { e.stopPropagation(); onWheel?.(e); }}
      onTouchMove={(e) => { e.stopPropagation(); onTouchMove?.(e); }}
      className={cn(
        "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
  );
});
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent };
