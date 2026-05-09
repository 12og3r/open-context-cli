import React, { createContext, useContext } from "react";
import { DEFAULT_LANG, type Lang } from "../lib/i18n.ts";

// Components rendered without a provider (e.g. in tests) get the default
// English so existing snapshots / string-pin tests keep working.
const LangContext = createContext<Lang>(DEFAULT_LANG);

export function LangProvider({
  value,
  children,
}: {
  value: Lang;
  children: React.ReactNode;
}) {
  return React.createElement(LangContext.Provider, { value }, children);
}

export function useLang(): Lang {
  return useContext(LangContext);
}
