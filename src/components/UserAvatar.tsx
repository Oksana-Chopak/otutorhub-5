import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  url?: string | null;
  firstName?: string;
  lastName?: string;
  className?: string;
}

export function UserAvatar({ url, firstName = "", lastName = "", className }: UserAvatarProps) {
  const initials = `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase() || "?";
  return (
    <Avatar className={cn("h-10 w-10", className)}>
      {url ? <AvatarImage src={url} alt={`${firstName} ${lastName}`.trim()} /> : null}
      <AvatarFallback className="bg-secondary text-foreground text-sm font-semibold">
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
