export type ThemeColor = 'zinc' | 'red' | 'rose' | 'orange' | 'green' | 'blue' | 'yellow' | 'violet';

export const THEMES: Record<ThemeColor, {
  label: string;
  activeColor: string;
  cssVars: {
    light: {
      primary: string;
      primaryForeground: string;
      ring: string;
    };
    dark: {
      primary: string;
      primaryForeground: string;
      ring: string;
    };
  };
}> = {
  zinc: {
    label: 'Zinc',
    activeColor: 'hsl(240 5.9% 10%)',
    cssVars: {
      light: {
        primary: '240 5.9% 10%',
        primaryForeground: '0 0% 98%',
        ring: '240 5.9% 10%',
      },
      dark: {
        primary: '0 0% 98%',
        primaryForeground: '240 5.9% 10%',
        ring: '240 4.9% 83.9%',
      },
    },
  },
  red: {
    label: 'Red',
    activeColor: 'hsl(0 72.2% 50.6%)',
    cssVars: {
      light: {
        primary: '0 72.2% 50.6%',
        primaryForeground: '0 85.7% 97.3%',
        ring: '0 72.2% 50.6%',
      },
      dark: {
        primary: '0 72.2% 50.6%',
        primaryForeground: '0 85.7% 97.3%',
        ring: '0 72.2% 50.6%',
      },
    },
  },
  rose: {
    label: 'Rose',
    activeColor: 'hsl(346.8 77.2% 49.8%)',
    cssVars: {
      light: {
        primary: '346.8 77.2% 49.8%',
        primaryForeground: '355.7 100% 97.3%',
        ring: '346.8 77.2% 49.8%',
      },
      dark: {
        primary: '346.8 77.2% 49.8%',
        primaryForeground: '355.7 100% 97.3%',
        ring: '346.8 77.2% 49.8%',
      },
    },
  },
  orange: {
    label: 'Orange',
    activeColor: 'hsl(24.6 95% 53.1%)',
    cssVars: {
      light: {
        primary: '24.6 95% 53.1%',
        primaryForeground: '60 9.1% 97.8%',
        ring: '24.6 95% 53.1%',
      },
      dark: {
        primary: '24.6 95% 53.1%',
        primaryForeground: '60 9.1% 97.8%',
        ring: '24.6 95% 53.1%',
      },
    },
  },
  green: {
    label: 'Green',
    activeColor: 'hsl(142.1 76.2% 36.3%)',
    cssVars: {
      light: {
        primary: '142.1 76.2% 36.3%',
        primaryForeground: '355.7 100% 97.3%',
        ring: '142.1 76.2% 36.3%',
      },
      dark: {
        primary: '142.1 76.2% 36.3%',
        primaryForeground: '355.7 100% 97.3%',
        ring: '142.1 76.2% 36.3%',
      },
    },
  },
  blue: {
    label: 'Blue',
    activeColor: 'hsl(221.2 83.2% 53.3%)',
    cssVars: {
      light: {
        primary: '221.2 83.2% 53.3%',
        primaryForeground: '210 40% 98%',
        ring: '221.2 83.2% 53.3%',
      },
      dark: {
        primary: '217.2 91.2% 59.8%',
        primaryForeground: '222.2 47.4% 11.2%',
        ring: '217.2 91.2% 59.8%',
      },
    },
  },
  yellow: {
    label: 'Yellow',
    activeColor: 'hsl(47.9 95.8% 53.1%)',
    cssVars: {
      light: {
        primary: '47.9 95.8% 53.1%',
        primaryForeground: '26 83.3% 14.1%',
        ring: '47.9 95.8% 53.1%',
      },
      dark: {
        primary: '47.9 95.8% 53.1%',
        primaryForeground: '26 83.3% 14.1%',
        ring: '47.9 95.8% 53.1%',
      },
    },
  },
  violet: {
    label: 'Violet',
    activeColor: 'hsl(262.1 83.3% 57.8%)',
    cssVars: {
      light: {
        primary: '262.1 83.3% 57.8%',
        primaryForeground: '210 40% 98%',
        ring: '262.1 83.3% 57.8%',
      },
      dark: {
        primary: '263.4 70% 50.4%',
        primaryForeground: '210 40% 98%',
        ring: '263.4 70% 50.4%',
      },
    },
  },
};
