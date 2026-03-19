export interface Tutor {
  id: string;
  name: string;
  subject: string;
  rate: number; // per lesson
  avatar: string;
}

export interface Student {
  id: string;
  name: string;
  subject: string;
  avatar: string;
}

export interface Lesson {
  id: string;
  tutorId: string;
  studentId: string;
  date: string;
  time: string;
  duration: number; // minutes
  subject: string;
  status: "scheduled" | "completed" | "cancelled";
}

export interface Payment {
  id: string;
  type: "income" | "expense";
  personId: string;
  personName: string;
  amount: number;
  date: string;
  status: "paid" | "pending";
  description: string;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
}

export interface Chat {
  id: string;
  tutorId: string;
  studentId: string;
  tutorName: string;
  studentName: string;
  subject: string;
  messages: ChatMessage[];
  lastMessage: string;
  lastMessageTime: string;
}

export const tutors: Tutor[] = [
  { id: "t1", name: "Олена Коваленко", subject: "Англійська", rate: 400, avatar: "ОК" },
  { id: "t2", name: "Ігор Петренко", subject: "Математика", rate: 350, avatar: "ІП" },
  { id: "t3", name: "Марія Сидоренко", subject: "Українська мова", rate: 300, avatar: "МС" },
];

export const students: Student[] = [
  { id: "s1", name: "Артем Бондаренко", subject: "Англійська", avatar: "АБ" },
  { id: "s2", name: "Софія Мельник", subject: "Математика", avatar: "СМ" },
  { id: "s3", name: "Данило Шевченко", subject: "Українська мова", avatar: "ДШ" },
];

export const lessons: Lesson[] = [
  { id: "l1", tutorId: "t1", studentId: "s1", date: "2026-03-19", time: "10:00", duration: 60, subject: "Англійська", status: "scheduled" },
  { id: "l2", tutorId: "t2", studentId: "s2", date: "2026-03-19", time: "14:00", duration: 60, subject: "Математика", status: "scheduled" },
  { id: "l3", tutorId: "t3", studentId: "s3", date: "2026-03-19", time: "16:00", duration: 60, subject: "Українська мова", status: "completed" },
  { id: "l4", tutorId: "t1", studentId: "s1", date: "2026-03-20", time: "10:00", duration: 60, subject: "Англійська", status: "scheduled" },
  { id: "l5", tutorId: "t2", studentId: "s2", date: "2026-03-18", time: "14:00", duration: 60, subject: "Математика", status: "completed" },
  { id: "l6", tutorId: "t3", studentId: "s3", date: "2026-03-17", time: "16:00", duration: 60, subject: "Українська мова", status: "completed" },
];

export const payments: Payment[] = [
  { id: "p1", type: "income", personId: "s1", personName: "Артем Бондаренко", amount: 500, date: "2026-03-15", status: "paid", description: "Оплата за 1 урок англійської" },
  { id: "p2", type: "income", personId: "s2", personName: "Софія Мельник", amount: 450, date: "2026-03-15", status: "paid", description: "Оплата за 1 урок математики" },
  { id: "p3", type: "income", personId: "s3", personName: "Данило Шевченко", amount: 400, date: "2026-03-16", status: "pending", description: "Оплата за 1 урок української" },
  { id: "p4", type: "expense", personId: "t1", personName: "Олена Коваленко", amount: 400, date: "2026-03-17", status: "paid", description: "Виплата за урок 17.03" },
  { id: "p5", type: "expense", personId: "t2", personName: "Ігор Петренко", amount: 350, date: "2026-03-18", status: "paid", description: "Виплата за урок 18.03" },
  { id: "p6", type: "expense", personId: "t3", personName: "Марія Сидоренко", amount: 300, date: "2026-03-17", status: "pending", description: "Виплата за урок 17.03" },
];

export const chats: Chat[] = [
  {
    id: "c1", tutorId: "t1", studentId: "s1", tutorName: "Олена Коваленко", studentName: "Артем Бондаренко", subject: "Англійська",
    lastMessage: "Добре, зробив вправу 5", lastMessageTime: "10:32",
    messages: [
      { id: "m1", senderId: "t1", senderName: "Олена Коваленко", text: "Привіт, Артеме! Як домашнє завдання?", timestamp: "10:15" },
      { id: "m2", senderId: "s1", senderName: "Артем Бондаренко", text: "Привіт! Ще роблю вправу 5", timestamp: "10:20" },
      { id: "m3", senderId: "t1", senderName: "Олена Коваленко", text: "Гарно, не поспішай. Головне — якість.", timestamp: "10:25" },
      { id: "m4", senderId: "s1", senderName: "Артем Бондаренко", text: "Добре, зробив вправу 5", timestamp: "10:32" },
    ],
  },
  {
    id: "c2", tutorId: "t2", studentId: "s2", tutorName: "Ігор Петренко", studentName: "Софія Мельник", subject: "Математика",
    lastMessage: "Завтра розберемо інтеграли", lastMessageTime: "09:45",
    messages: [
      { id: "m5", senderId: "t2", senderName: "Ігор Петренко", text: "Софіє, підготуй параграф 12 до завтра", timestamp: "09:30" },
      { id: "m6", senderId: "s2", senderName: "Софія Мельник", text: "Добре! А що саме розберемо?", timestamp: "09:40" },
      { id: "m7", senderId: "t2", senderName: "Ігор Петренко", text: "Завтра розберемо інтеграли", timestamp: "09:45" },
    ],
  },
  {
    id: "c3", tutorId: "t3", studentId: "s3", tutorName: "Марія Сидоренко", studentName: "Данило Шевченко", subject: "Українська мова",
    lastMessage: "Дякую за пояснення!", lastMessageTime: "Вчора",
    messages: [
      { id: "m8", senderId: "s3", senderName: "Данило Шевченко", text: "Маріє Іванівно, не зрозумів правило з апострофом", timestamp: "Вчора, 18:00" },
      { id: "m9", senderId: "t3", senderName: "Марія Сидоренко", text: "Апостроф ставиться після б, п, в, м, ф перед я, ю, є, ї", timestamp: "Вчора, 18:15" },
      { id: "m10", senderId: "s3", senderName: "Данило Шевченко", text: "Дякую за пояснення!", timestamp: "Вчора, 18:20" },
    ],
  },
];

export function getTutorById(id: string) {
  return tutors.find((t) => t.id === id);
}

export function getStudentById(id: string) {
  return students.find((s) => s.id === id);
}
