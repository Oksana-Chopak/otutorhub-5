#!/usr/bin/env python3
"""
Patch Guardian for oTutorHub.
Runs after every Lovable commit and re-applies critical patches.
"""
import re, os, sys

patched = []

def check_and_patch(path, marker, apply_fn, name):
    if not os.path.exists(path):
        print(f"⚠️  {name}: file not found — {path}")
        return
    with open(path, encoding='utf-8') as f:
        content = f.read()
    if marker in content:
        print(f"✅ {name}")
        return
    new = apply_fn(content)
    if new == content:
        print(f"⚠️  {name}: MISSING but could not auto-apply — manual fix needed")
        return
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new)
    print(f"🔧 {name}: RESTORED")
    patched.append(name)

# ── PATCH 1: Auth tabs — active tab must be visually distinct ─────────────────
def fix_auth_tabs(c):
    # Lovable generates: data-[state=active]:bg-background data-[state=active]:shadow-sm
    # We need: teal bg + white text + muted inactive
    LOVABLE = 'data-[state=active]:bg-background data-[state=active]:shadow-sm'
    OURS    = 'font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=inactive]:text-muted-foreground'
    if LOVABLE in c:
        return c.replace(LOVABLE, OURS)
    # Fallback: target each TabsTrigger by value and inject our className
    def replace_trigger(m):
        val = m.group(1)  # "signin" or "signup"
        label = m.group(2)  # {t("auth.tabSignIn")} etc
        return (
            f'<TabsTrigger value="{val}" className="rounded-md font-medium '
            f'data-[state=active]:bg-primary data-[state=active]:text-primary-foreground '
            f'data-[state=active]:shadow-sm data-[state=inactive]:text-muted-foreground">'
            f'{label}</TabsTrigger>'
        )
    return re.sub(
        r'<TabsTrigger value="(signin|signup)"[^>]*>(\{t\("auth\.tab[^"]+"\)\})</TabsTrigger>',
        replace_trigger, c
    )

check_and_patch(
    'src/pages/AuthPage.tsx',
    'data-[state=active]:bg-primary data-[state=active]:text-primary-foreground',
    fix_auth_tabs,
    'Auth tabs — active state teal'
)

# ── PATCH 2: Dashboard — sessionStorage instead of localStorage ───────────────
def fix_dashboard_onboarding(c):
    OLD = '''  // First-session redirect: new independent tutor → /onboarding.
  // Uses localStorage so we only auto-redirect once per device per user.
  useEffect(() => {
    if (wsLoading || !user || !isIndependentTutor) return;
    if (settings?.onboarding_completed) return;
    const key = `onboarding_shown_${user.id}`;
    if (localStorage.getItem(key) === "1") return;
    localStorage.setItem(key, "1");
    navigate("/onboarding", { replace: true });
  }, [wsLoading, user?.id, isIndependentTutor, settings?.onboarding_completed, navigate]);'''
    NEW = '''  // First-session redirect: new independent tutor → /onboarding.
  // Source of truth: Supabase onboarding_completed. sessionStorage prevents
  // repeated redirects within one browser session; new device always redirects.
  useEffect(() => {
    if (wsLoading || !user || !isIndependentTutor || !settings) return;
    if (settings.onboarding_completed) return;
    const sessionKey = `onboarding_redirected_${user.id}`;
    if (sessionStorage.getItem(sessionKey) === "1") return;
    sessionStorage.setItem(sessionKey, "1");
    navigate("/onboarding", { replace: true });
  }, [wsLoading, user?.id, isIndependentTutor, settings, navigate]);'''
    if OLD in c:
        return c.replace(OLD, NEW)
    # If Lovable changed surrounding comments, use a looser match
    c = re.sub(
        r'(const key = `onboarding_shown_\$\{user\.id\}`;\s*\n\s*if \(localStorage\.getItem\(key\) === "1"\) return;\s*\n\s*localStorage\.setItem\(key, "1"\);)',
        'const sessionKey = `onboarding_redirected_${user.id}`;\n    if (sessionStorage.getItem(sessionKey) === "1") return;\n    sessionStorage.setItem(sessionKey, "1");',
        c
    )
    return c

check_and_patch(
    'src/pages/DashboardPage.tsx',
    'sessionStorage.getItem(sessionKey)',
    fix_dashboard_onboarding,
    'Dashboard — sessionStorage onboarding redirect'
)

# ── PATCH 3: Auth confirmed — auto-fill email + focus password ────────────────
def fix_auth_confirmed(c):
    # Add email auto-fill after isConfirmed check — find the toast block
    OLD = '''    toast({
      title: t("authExtra.emailConfirmed"),
      description: t("authExtra.emailConfirmedDesc"),
    });
  }, [isConfirmed, authLoading, user, navigate]);'''
    NEW = '''    // Auto-fill email so the user only needs to type password
    const emailFromConfirm = searchParams.get("email");
    if (emailFromConfirm) {
      setSignInData((prev) => ({ ...prev, email: emailFromConfirm }));
    }
    toast({
      title: t("authExtra.emailConfirmed"),
      description: t("authExtra.emailConfirmedDesc"),
    });
    // Move focus to password field
    setTimeout(() => {
      document.getElementById("signin-password")?.focus();
    }, 300);
  }, [isConfirmed, authLoading, user, navigate, searchParams]);'''
    return c.replace(OLD, NEW) if OLD in c else c

check_and_patch(
    'src/pages/AuthPage.tsx',
    'document.getElementById("signin-password")?.focus()',
    fix_auth_confirmed,
    'Auth — email auto-fill + focus after confirmation'
)

# ── PATCH 4: StepVictoryOverlay — i18n instead of hardcoded strings ──────────
def fix_victory_overlay(c):
    if 'useTranslation' not in c:
        c = c.replace(
            'import { useEffect } from "react";\nimport confetti from "canvas-confetti";',
            'import { useEffect } from "react";\nimport confetti from "canvas-confetti";\nimport { useTranslation } from "react-i18next";'
        )
        c = c.replace(
            'export function StepVictoryOverlay({ emoji, title, xp, isFinal, onDone }: Props) {',
            'export function StepVictoryOverlay({ emoji, title, xp, isFinal, onDone }: Props) {\n  const { t } = useTranslation();'
        )
    c = c.replace(
        '{isFinal ? "Всі квести виконано! 🎉" : "Крок завершено!"}',
        '{isFinal ? t("stepVictory.allDone") : t("stepVictory.stepDone")}'
    )
    return c

check_and_patch(
    'src/components/StepVictoryOverlay.tsx',
    't("stepVictory.allDone")',
    fix_victory_overlay,
    'StepVictoryOverlay — i18n strings'
)

# ── PATCH 5: i18n — stepVictory keys in all locales ──────────────────────────
STEP_VICTORY_BLOCKS = {
    'src/i18n/locales/uk.ts': (
        '  questDone: "🎉 Готово! Усі досягнення виконано",',
        '  questDone: "🎉 Готово! Усі досягнення виконано",\n  stepVictory: {\n    stepDone: "Крок завершено!",\n    allDone: "Всі квести виконано! 🎉",\n  },'
    ),
    'src/i18n/locales/en.ts': (
        '  questDone: "🎉 All achievements unlocked!",',
        '  questDone: "🎉 All achievements unlocked!",\n  stepVictory: {\n    stepDone: "Step complete!",\n    allDone: "All quests done! 🎉",\n  },'
    ),
    'src/i18n/locales/sv.ts': (
        '  questDone: "🎉 Alla prestationer klara!",',
        '  questDone: "🎉 Alla prestationer klara!",\n  stepVictory: {\n    stepDone: "Steg slutfört!",\n    allDone: "Alla uppdrag klara! 🎉",\n  },'
    ),
}
for locale_path, (old_key, new_block) in STEP_VICTORY_BLOCKS.items():
    check_and_patch(
        locale_path,
        'stepVictory:',
        lambda c, o=old_key, n=new_block: c.replace(o, n),
        f'i18n stepVictory keys — {locale_path.split("/")[-1]}'
    )


# ── PATCH 6: FinancesPage — expensesRows useMemo with isIndependentTutor ─────
def fix_finances_expenses_rows(c):
    # expensesRows useMemo was deleted by Lovable — independent tutors saw wrong expenses
    if 'expensesRows' in c:
        return c  # already present
    old = '  }, [periodBillable, periodTopups, canManagePrepay, sort]);\n\n  const debtsRows'
    new = '''  }, [periodBillable, periodTopups, canManagePrepay, sort]);

  const expensesRows: Row[] = useMemo(() => {
    if (isIndependentTutor) return [];
    return periodBillable
      .filter((l) => l.tutor_payout_status === "paid")
      .map((l) => ({ type: "lesson" as const, l }))
      .sort(activeSort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodBillable, isIndependentTutor, sort]);

  const debtsRows'''
    return c.replace(old, new) if old in c else c

check_and_patch(
    'src/pages/FinancesPage.tsx',
    'expensesRows',
    fix_finances_expenses_rows,
    'FinancesPage — expensesRows data isolation'
)


# ── PATCH 7: i18n — default to Ukrainian, not browser locale ─────────────────
def fix_i18n_default_lang(c):
    old = '''    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "otutorhub_lang",
      caches: ["localStorage"],
    },'''
    new = '''    lng: (() => {
      const stored = typeof localStorage !== "undefined"
        ? localStorage.getItem("otutorhub_lang")
        : null;
      return stored && ["uk", "en", "sv"].includes(stored) ? stored : "uk";
    })(),
    detection: {
      order: ["localStorage"],
      lookupLocalStorage: "otutorhub_lang",
      caches: ["localStorage"],
    },'''
    return c.replace(old, new) if old in c else c

check_and_patch(
    'src/i18n/index.ts',
    'return stored && ["uk", "en", "sv"].includes(stored)',
    fix_i18n_default_lang,
    'i18n — default Ukrainian, not browser locale'
)

# ── PATCH 8: DashboardPage — no hardcoded +12%, real MoM growth ──────────────
check_and_patch(
    'src/pages/DashboardPage.tsx',
    'prevMonthProfit',
    lambda c: c,  # complex patch — flag for manual fix if missing
    'DashboardPage — real MoM profit growth (no hardcoded +12%)'
)

# ── Output result ──────────────────────────────────────────────────────────────
if patched:
    with open(os.environ.get('GITHUB_OUTPUT', '/tmp/gha_output'), 'a') as f:
        f.write('patched=true\n')
    with open('.github/scripts/patch_log.txt', 'w') as f:
        f.write('\n'.join(f'- {p}' for p in patched))
    print(f"\n✅ Restored {len(patched)} patch(es): {', '.join(patched)}")
else:
    with open(os.environ.get('GITHUB_OUTPUT', '/tmp/gha_output'), 'a') as f:
        f.write('patched=false\n')
    print("\n✅ All patches in place — nothing to restore")
