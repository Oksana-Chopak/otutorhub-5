import { AppLayout } from "@/components/AppLayout";
import { chats, type Chat } from "@/lib/mock-data";
import { MessageSquare, Eye } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export default function ChatsPage() {
  const [selectedChat, setSelectedChat] = useState<Chat>(chats[0]);

  return (
    <AppLayout>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-foreground">Чати</h1>
        <p className="text-sm text-muted-foreground">Перегляд переписок учнів та репетиторів</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* Chat list */}
        <div className="space-y-2 rounded-xl border border-border bg-card p-3">
          {chats.map((chat) => (
            <button
              key={chat.id}
              onClick={() => setSelectedChat(chat)}
              className={cn(
                "w-full rounded-lg p-3 text-left transition-colors",
                selectedChat.id === chat.id
                  ? "bg-primary/10"
                  : "hover:bg-secondary"
              )}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">{chat.subject}</p>
                <span className="text-xs text-muted-foreground">{chat.lastMessageTime}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {chat.tutorName} ↔ {chat.studentName}
              </p>
              <p className="text-xs text-muted-foreground mt-1 truncate">{chat.lastMessage}</p>
            </button>
          ))}
        </div>

        {/* Chat detail */}
        <div className="rounded-xl border border-border bg-card flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <p className="text-sm font-semibold text-foreground">{selectedChat.subject}</p>
              <p className="text-xs text-muted-foreground">
                {selectedChat.tutorName} ↔ {selectedChat.studentName}
              </p>
            </div>
            <Badge variant="secondary" className="gap-1">
              <Eye className="h-3 w-3" />
              Режим перегляду
            </Badge>
          </div>

          {/* Messages */}
          <div className="flex-1 space-y-3 p-5 min-h-[300px]">
            {selectedChat.messages.map((msg) => {
              const isTutor = msg.senderId.startsWith("t");
              return (
                <div key={msg.id} className={cn("flex", isTutor ? "justify-start" : "justify-end")}>
                  <div
                    className={cn(
                      "max-w-[70%] rounded-xl px-4 py-2.5",
                      isTutor
                        ? "bg-secondary text-foreground"
                        : "bg-primary text-primary-foreground"
                    )}
                  >
                    <p className="text-xs font-medium mb-1 opacity-70">{msg.senderName}</p>
                    <p className="text-sm">{msg.text}</p>
                    <p className="text-[10px] mt-1 opacity-50 text-right">{msg.timestamp}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Manager notice */}
          <div className="border-t border-border px-5 py-3 flex items-center gap-2 text-muted-foreground">
            <MessageSquare className="h-4 w-4" />
            <span className="text-xs">Ви переглядаєте цей чат як менеджер</span>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
