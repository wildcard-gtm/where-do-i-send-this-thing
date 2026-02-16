"use client";

import { useState } from "react";
import Sidebar from "./sidebar";
import Header from "./header";

interface DashboardShellProps {
  user: { id: string; email: string; name: string; role?: string };
  children: React.ReactNode;
}

export default function DashboardShell({ user, children }: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="theme-dashboard min-h-screen bg-background flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        user={user}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <Header onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
        <main className="flex-1 p-4 md:p-6 overflow-auto animate-fade-in-up">{children}</main>
        <footer className="border-t border-border/50 px-4 md:px-6 py-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
            <p>&copy; {new Date().getFullYear()} Wildcard. All rights reserved.</p>
            <div className="flex items-center gap-4">
              <a href="/privacy" className="hover:text-foreground transition">Privacy</a>
              <a href="/terms" className="hover:text-foreground transition">Terms</a>
              <a href="/contact" className="hover:text-foreground transition">Contact</a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
