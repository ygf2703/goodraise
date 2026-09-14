// Public field limits/topics shared by the form and the server. Recipients and
// provider configuration are deliberately server-only.
export const CONTACT_LIMITS = { name: 100, email: 254, message: 4000 };
export const CONTACT_TOPICS = [
  { value: "general", label: "שאלה כללית" },
  { value: "campaign", label: "פתיחת קמפיין" },
  { value: "account", label: "כניסה והרשאות" },
  { value: "technical", label: "עזרה טכנית" },
  { value: "accessibility", label: "נגישות" },
];
