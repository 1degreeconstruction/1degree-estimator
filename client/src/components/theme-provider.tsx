import { createContext, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light";

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (theme: Theme) => void;
  forceLight: boolean;
  setForceLight: (v: boolean) => void;
}>({
  theme: "dark",
  setTheme: () => {},
  forceLight: false,
  setForceLight: () => {},
});

export function ThemeProvider({ children, defaultTheme = "dark" }: { children: React.ReactNode; defaultTheme?: Theme }) {
  const [theme, setTheme] = useState<Theme>(defaultTheme);
  const [forceLight, setForceLight] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    if (forceLight) {
      // Don't add dark class — light is the default
    } else {
      root.classList.add(theme);
    }
  }, [theme, forceLight]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, forceLight, setForceLight }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

export function useForceLightMode() {
  const { setForceLight } = useContext(ThemeContext);
  useEffect(() => {
    setForceLight(true);
    return () => setForceLight(false);
  }, [setForceLight]);
}
