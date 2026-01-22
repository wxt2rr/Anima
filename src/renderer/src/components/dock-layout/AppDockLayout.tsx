import React, { useRef } from 'react';
import DockLayout, { LayoutData } from 'rc-dock';
import "rc-dock/dist/rc-dock.css";

interface AppDockLayoutProps {
  defaultLayout: LayoutData;
}

export const AppDockLayout: React.FC<AppDockLayoutProps> = ({ defaultLayout }) => {
  const dockRef = useRef<DockLayout>(null);

  return (
    <div className="dock-layout-wrapper w-full h-full relative" style={{ background: 'var(--background)' }}>
      <DockLayout
        ref={dockRef}
        defaultLayout={defaultLayout}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
};
