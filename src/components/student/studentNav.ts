import { CalendarDays, MessageSquare, DollarSign, BookOpen, LayoutDashboard, UserCircle } from "lucide-react";

/**
 * Student navigation definitions — the single source of truth for the student role's
 * pages. Consumed by AppSidebar (desktop nav) and MobileBottomNav (mobile tabs), so the
 * student now rides the SAME shared chrome (AppLayout/AppSidebar) as every other role.
 */
export const STUDENT_NAV_DEFS = [
  { to: "/student-dashboard", labelKey: "studentNav.dashboard", titleKey: "studentNav.myDashboard", icon: LayoutDashboard },
  { to: "/student/schedule", labelKey: "studentNav.schedule", titleKey: "studentNav.schedule", icon: CalendarDays },
  { to: "/student/payments", labelKey: "studentNav.payments", titleKey: "studentNav.payments", icon: DollarSign },
  { to: "/student/homework", labelKey: "studentNav.homework", titleKey: "studentNav.myHomework", icon: BookOpen },
  { to: "/chats", labelKey: "studentNav.chats", titleKey: "studentNav.chats", icon: MessageSquare, badgeKey: "chats" as const },
  { to: "/student/profile", labelKey: "studentNav.profile", titleKey: "studentNav.profile", icon: UserCircle },
];
