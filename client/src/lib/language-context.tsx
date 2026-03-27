import { createContext, useContext, useState, useEffect } from "react";
import { en, ar, type TranslationKey } from "@/locales/translations";

type Lang = "en" | "ar";

interface LanguageContextValue {
  lang: Lang;
  toggleLang: () => void;
  isRTL: boolean;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: "en",
  toggleLang: () => {},
  isRTL: false,
  t: (key) => en[key],
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    return (localStorage.getItem("lang") as Lang) ?? "en";
  });

  useEffect(() => {
    document.documentElement.setAttribute("lang", lang);
    document.documentElement.setAttribute("dir", lang === "ar" ? "rtl" : "ltr");
    localStorage.setItem("lang", lang);
  }, [lang]);

  const toggleLang = () => setLang(l => (l === "en" ? "ar" : "en"));
  const t = (key: TranslationKey): string => (lang === "ar" ? ar : en)[key];

  return (
    <LanguageContext.Provider value={{ lang, toggleLang, isRTL: lang === "ar", t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
