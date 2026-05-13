import { useEffect, useState } from "react";
import { StudentLayout } from "@/components/student/StudentLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TelegramLinkCard } from "@/components/TelegramLinkCard";
import { GoogleCalendarCard } from "@/components/GoogleCalendarCard";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function StudentProfilePage() {
  const { user, signOut } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: profile }, { data: contact }] = await Promise.all([
        supabase.from("profiles").select("first_name, last_name").eq("id", user.id).maybeSingle(),
        supabase.from("profile_contacts").select("phone").eq("user_id", user.id).maybeSingle(),
      ]);
      setFirstName(profile?.first_name ?? "");
      setLastName(profile?.last_name ?? "");
      setPhone(contact?.phone ?? "");
      setLoading(false);
    })();
  }, [user?.id]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const { error: pErr } = await supabase
      .from("profiles")
      .update({ first_name: firstName.trim(), last_name: lastName.trim() })
      .eq("id", user.id);
    const { error: cErr } = await supabase
      .from("profile_contacts")
      .upsert({ user_id: user.id, phone: phone.trim() || null }, { onConflict: "user_id" });
    setSaving(false);
    if (pErr || cErr) {
      toast.error("Не вдалося зберегти");
      return;
    }
    toast.success("Збережено");
  };

  return (
    <StudentLayout>
      <div className="space-y-6">
        <h1 className="hidden text-2xl font-bold text-foreground lg:block">Профіль</h1>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <Card className="space-y-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fn">Ім'я</Label>
                <Input id="fn" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ln">Прізвище</Label>
                <Input id="ln" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ph">Телефон</Label>
              <Input id="ph" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={user?.email ?? ""} disabled />
            </div>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Зберегти
            </Button>
          </Card>
        )}

        <TelegramLinkCard />

        <Button variant="outline" onClick={signOut} className="w-full sm:w-auto">
          Вийти
        </Button>
      </div>
    </StudentLayout>
  );
}
